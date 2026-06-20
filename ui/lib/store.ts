import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Inspect-UI data layer. Reads/writes the SAME SQLite file the MCP server uses
 * (WAL mode allows concurrent access). It deliberately does NOT load the
 * embedding model — when content changes here, the stored vector is cleared and
 * the MCP server re-embeds it on its next startup (see backfillEmbeddings).
 */

export type MemoryType = "fact" | "preference" | "project" | "reference";

export interface Memory {
  id: number;
  content: string;
  type: MemoryType;
  tags: string[];
  source: string | null;
  has_embedding: boolean;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  id: number;
  content: string;
  type: MemoryType;
  tags: string | null;
  source: string | null;
  has_embedding: number;
  created_at: string;
  updated_at: string;
}

function dbPath(): string {
  const dir = process.env.ENGRAM_DIR ?? join(homedir(), ".engram");
  mkdirSync(dir, { recursive: true });
  return join(dir, "memory.db");
}

// Reuse a single connection across hot reloads in dev.
const g = globalThis as unknown as { __engramDb?: Database.Database };

function getDb(): Database.Database {
  if (!g.__engramDb) {
    const db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    // Idempotent schema — matches the MCP server so the UI works even if opened first.
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
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, content='memories', content_rowid='id'
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
    g.__engramDb = db;
  }
  return g.__engramDb;
}

const SELECT = `SELECT id, content, type, tags, source,
  (embedding IS NOT NULL) AS has_embedding, created_at, updated_at FROM memories`;

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    source: row.source,
    has_embedding: row.has_embedding === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function toFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

export function listMemories(): Memory[] {
  const rows = getDb()
    .prepare(`${SELECT} ORDER BY updated_at DESC LIMIT 500`)
    .all() as MemoryRow[];
  return rows.map(toMemory);
}

export function searchMemories(query: string): Memory[] {
  const match = toFtsQuery(query);
  if (!match) return listMemories();
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.content, m.type, m.tags, m.source,
         (m.embedding IS NOT NULL) AS has_embedding, m.created_at, m.updated_at
       FROM memories m
       JOIN memories_fts f ON f.rowid = m.id
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT 500`,
    )
    .all(match) as MemoryRow[];
  return rows.map(toMemory);
}

export function createMemory(input: {
  content: string;
  type?: MemoryType;
  tags?: string[];
}): Memory {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO memories (content, type, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.content.trim(), input.type ?? "fact", JSON.stringify(input.tags ?? []), ts, ts);
  return getMemory(Number(info.lastInsertRowid))!;
}

export function getMemory(id: number): Memory | null {
  const row = getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

export function updateMemory(
  id: number,
  patch: { content?: string; type?: MemoryType; tags?: string[] },
): Memory | null {
  const existing = getMemory(id);
  if (!existing) return null;
  const newContent = patch.content?.trim() ?? existing.content;
  const contentChanged = newContent !== existing.content;

  // Clearing the vector on content change lets the MCP server re-embed it.
  getDb()
    .prepare(
      `UPDATE memories SET content = ?, type = ?, tags = ?, updated_at = ?
       ${contentChanged ? ", embedding = NULL, embedding_model = NULL" : ""}
       WHERE id = ?`,
    )
    .run(
      newContent,
      patch.type ?? existing.type,
      JSON.stringify(patch.tags ?? existing.tags),
      nowIso(),
      id,
    );
  return getMemory(id);
}

export function deleteMemory(id: number): boolean {
  return getDb().prepare(`DELETE FROM memories WHERE id = ?`).run(id).changes > 0;
}
