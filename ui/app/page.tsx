"use client";

import { useCallback, useEffect, useState } from "react";

type MemoryType = "fact" | "preference" | "project" | "reference";

interface Memory {
  id: number;
  content: string;
  type: MemoryType;
  tags: string[];
  source: string | null;
  has_embedding: boolean;
  created_at: string;
  updated_at: string;
}

const TYPES: MemoryType[] = ["fact", "preference", "project", "reference"];

export default function Page() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<MemoryType>("fact");
  const [newTags, setNewTags] = useState("");

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const res = await fetch(`/api/memories${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const data = await res.json();
    setMemories(data.memories ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(query), 180);
    return () => clearTimeout(t);
  }, [query, load]);

  async function addMemory() {
    if (!newContent.trim()) return;
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newContent,
        type: newType,
        tags: newTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    setNewContent("");
    setNewTags("");
    void load(query);
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>Engram</h1>
        <a className="btn" href="/api/export">
          Export JSON
        </a>
      </header>
      <p className="tagline">Your memory, on your machine.</p>

      <input
        className="search"
        placeholder="Search your memory…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="composer">
        <textarea
          placeholder="Add a memory — a fact, preference, project, or reference…"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
        />
        <div className="row">
          <select value={newType} onChange={(e) => setNewType(e.target.value as MemoryType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="grow2"
            placeholder="tags, comma separated"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
          />
          <button className="btn primary" onClick={addMemory}>
            Add
          </button>
        </div>
      </div>

      <div className="count">
        {loading ? "Loading…" : `${memories.length} ${query ? "match" : "memor"}${memories.length === 1 ? (query ? "" : "y") : query ? "es" : "ies"}`}
      </div>

      {!loading && memories.length === 0 && (
        <div className="empty">No memories yet. Add one above.</div>
      )}

      {memories.map((m) => (
        <MemoryCard key={m.id} memory={m} onChanged={() => void load(query)} />
      ))}
    </div>
  );
}

function MemoryCard({ memory, onChanged }: { memory: Memory; onChanged: () => void }) {
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [tags, setTags] = useState(memory.tags.join(", "));
  const [saving, setSaving] = useState(false);

  const dirty =
    content !== memory.content || type !== memory.type || tags !== memory.tags.join(", ");

  async function save() {
    setSaving(true);
    await fetch(`/api/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        type,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    setSaving(false);
    onChanged();
  }

  async function remove() {
    await fetch(`/api/memories/${memory.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="card">
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="grow2"
          placeholder="tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
      </div>
      <div className="meta">
        <span className="badge">#{memory.id}</span>
        <span className={`badge ${memory.has_embedding ? "semantic" : ""}`}>
          {memory.has_embedding ? "semantic ✓" : "keyword only"}
        </span>
        <span className="spacer" />
        <span>updated {new Date(memory.updated_at).toLocaleString()}</span>
      </div>
      <div className="actions">
        <button className="btn danger" onClick={remove}>
          Delete
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
