import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getEmbedder } from "./embedder.js";

/**
 * Storage layer for Engram.
 *
 * The local SQLite file is the source of truth. WAL mode is enabled so the
 * MCP server and the (future) inspect UI can share the file concurrently.
 *
 * Recall is hybrid: FTS5 keyword matching fused with local-embedding cosine
 * similarity via reciprocal-rank fusion. When the embedder is unavailable it
 * degrades to keyword-only.
 */

export type MemoryType = "fact" | "preference" | "project" | "reference";

export interface Memory {
  id: number;
  content: string;
  type: MemoryType;
  tags: string[];
  source: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  id: number;
  content: string;
  type: MemoryType;
  tags: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function log(message: string): void {
  process.stderr.write(`[engram] ${message}\n`);
}

function dbPath(): string {
  const dir = process.env.ENGRAM_DIR ?? join(homedir(), ".engram");
  mkdirSync(dir, { recursive: true });
  return join(dir, "memory.db");
}

const db = new Database(dbPath());
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content         TEXT    NOT NULL,
    type            TEXT    NOT NULL DEFAULT 'fact',
    tags            TEXT    NOT NULL DEFAULT '[]',
    source          TEXT,
    embedding       BLOB,
    embedding_model TEXT,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
  );

  -- External-content FTS index over memories.content, kept in sync by triggers.
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
  END;
`);

const COLS = "id, content, type, tags, source, created_at, updated_at";

function now(): string {
  return new Date().toISOString();
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- vector <-> blob helpers (alignment-safe; vectors are small) -------------

function vecToBlob(v: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

function blobToVec(b: Buffer): Float32Array {
  const v = new Float32Array(b.byteLength / 4);
  for (let i = 0; i < v.length; i++) v[i] = b.readFloatLE(i * 4);
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// --- queries -----------------------------------------------------------------

const selectById = db.prepare(`SELECT ${COLS} FROM memories WHERE id = ?`);
const selectRowByContent = db.prepare(`SELECT * FROM memories WHERE content = ? LIMIT 1`);

async function embedPassageSafe(content: string): Promise<{ blob: Buffer; model: string } | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  try {
    const vec = await embedder.embedPassage(content);
    return { blob: vecToBlob(vec), model: embedder.model };
  } catch (err) {
    log(`embed failed (stored without vector): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Save a memory. Exact-trimmed-content matches are deduped: an existing memory
 * with identical content has its tags merged rather than creating a duplicate
 * — important because the hybrid-capture flow can re-propose the same fact.
 */
export async function saveMemory(input: {
  content: string;
  type?: MemoryType;
  tags?: string[];
  source?: string | null;
}): Promise<Memory> {
  const content = input.content.trim();

  const existing = selectRowByContent.get(content) as
    | (MemoryRow & { embedding: Buffer | null })
    | undefined;
  if (existing) {
    const mergedTags = Array.from(
      new Set([...(existing.tags ? JSON.parse(existing.tags) : []), ...(input.tags ?? [])]),
    );
    db.prepare(`UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(mergedTags),
      now(),
      existing.id,
    );
    return rowToMemory(selectById.get(existing.id) as MemoryRow);
  }

  const embedded = await embedPassageSafe(content);
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO memories (content, type, tags, source, embedding, embedding_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      content,
      input.type ?? "fact",
      JSON.stringify(input.tags ?? []),
      input.source ?? null,
      embedded?.blob ?? null,
      embedded?.model ?? null,
      ts,
      ts,
    );
  return rowToMemory(selectById.get(Number(info.lastInsertRowid)) as MemoryRow);
}

/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression: each alphanumeric
 * token becomes a prefix term, OR-joined. Returns null when nothing usable
 * remains.
 */
function toFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

const RRF_K = 60;

/**
 * Hybrid recall: fuse FTS5 keyword ranking with local-embedding cosine ranking
 * using reciprocal-rank fusion. Falls back to keyword-only (no embedder) or to
 * recent memories (no signal at all).
 */
export async function recall(query: string, limit = 10): Promise<Memory[]> {
  const scores = new Map<number, number>();

  const match = toFtsQuery(query);
  if (match) {
    const kw = db
      .prepare(
        `SELECT m.id AS id FROM memories m
         JOIN memories_fts f ON f.rowid = m.id
         WHERE memories_fts MATCH ?
         ORDER BY rank
         LIMIT 50`,
      )
      .all(match) as { id: number }[];
    kw.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + i)));
  }

  const embedder = await getEmbedder();
  if (embedder) {
    try {
      const qVec = await embedder.embedQuery(query);
      const rows = db
        .prepare(`SELECT id, embedding FROM memories WHERE embedding IS NOT NULL`)
        .all() as { id: number; embedding: Buffer }[];
      const ranked = rows
        .map((r) => ({ id: r.id, sim: cosine(qVec, blobToVec(r.embedding)) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 50);
      ranked.forEach((r, i) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + i)));
    } catch (err) {
      log(`semantic recall skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (scores.size === 0) return listMemories({ limit });

  const topIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
  return topIds
    .map((id) => getMemory(id))
    .filter((m): m is Memory => m !== null);
}

export function listMemories(opts: { type?: MemoryType; limit?: number } = {}): Memory[] {
  const limit = opts.limit ?? 50;
  const rows = opts.type
    ? (db
        .prepare(`SELECT ${COLS} FROM memories WHERE type = ? ORDER BY updated_at DESC LIMIT ?`)
        .all(opts.type, limit) as MemoryRow[])
    : (db
        .prepare(`SELECT ${COLS} FROM memories ORDER BY updated_at DESC LIMIT ?`)
        .all(limit) as MemoryRow[]);
  return rows.map(rowToMemory);
}

export function getMemory(id: number): Memory | null {
  const row = selectById.get(id) as MemoryRow | undefined;
  return row ? rowToMemory(row) : null;
}

/** Edit a memory. If the content changes, its embedding is recomputed. */
export async function updateMemory(
  id: number,
  patch: { content?: string; type?: MemoryType; tags?: string[] },
): Promise<Memory | null> {
  const existing = selectById.get(id) as MemoryRow | undefined;
  if (!existing) return null;

  const newContent = patch.content?.trim() ?? existing.content;
  const contentChanged = newContent !== existing.content;

  if (contentChanged) {
    const embedded = await embedPassageSafe(newContent);
    db.prepare(
      `UPDATE memories SET content = ?, type = ?, tags = ?, embedding = ?, embedding_model = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      newContent,
      patch.type ?? existing.type,
      patch.tags ? JSON.stringify(patch.tags) : existing.tags,
      embedded?.blob ?? null,
      embedded?.model ?? null,
      now(),
      id,
    );
  } else {
    db.prepare(`UPDATE memories SET type = ?, tags = ?, updated_at = ? WHERE id = ?`).run(
      patch.type ?? existing.type,
      patch.tags ? JSON.stringify(patch.tags) : existing.tags,
      now(),
      id,
    );
  }
  return rowToMemory(selectById.get(id) as MemoryRow);
}

export function forgetMemory(id: number): boolean {
  const info = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return info.changes > 0;
}

/**
 * Bulk-import memories (e.g. from another tool's export). Reuses saveMemory so
 * each item is deduped and embedded; reports how many were new vs merged.
 */
export async function importMemories(
  items: { content: string; type?: MemoryType; tags?: string[] }[],
): Promise<{ imported: number; merged: number; skipped: number }> {
  let imported = 0;
  let merged = 0;
  let skipped = 0;
  for (const item of items) {
    const content = (item.content ?? "").trim();
    if (!content) {
      skipped++;
      continue;
    }
    const existed = selectRowByContent.get(content) as MemoryRow | undefined;
    await saveMemory({ content, type: item.type, tags: item.tags });
    if (existed) merged++;
    else imported++;
  }
  return { imported, merged, skipped };
}

/**
 * Re-embed any memories that have no vector — e.g. ones created or edited via
 * the inspect UI (which doesn't load the model) or saved while the embedder was
 * unavailable. Self-healing: keeps semantic recall complete without coupling
 * the UI to the ML stack. Runs once at server startup.
 */
export async function backfillEmbeddings(): Promise<number> {
  const embedder = await getEmbedder();
  if (!embedder) return 0;
  const rows = db
    .prepare(`SELECT id, content FROM memories WHERE embedding IS NULL`)
    .all() as { id: number; content: string }[];
  let count = 0;
  for (const row of rows) {
    try {
      const vec = await embedder.embedPassage(row.content);
      db.prepare(`UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`).run(
        vecToBlob(vec),
        embedder.model,
        row.id,
      );
      count++;
    } catch (err) {
      log(`backfill skipped #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return count;
}
