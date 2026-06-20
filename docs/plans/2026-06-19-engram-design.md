# Engram — v1 Design

**A local-first personal memory server that any MCP client plugs into, so your context follows _you_ across apps instead of living inside one vendor.**

Status: design validated 2026-06-19. Author: Kalyan Gopalam.

---

## Thesis

Every model platform is building memory into its own walls. Engram is the open, user-owned alternative: your context, preferences, and history live on _your_ machine, in a store _you_ control, exposed over MCP so it works across every MCP-capable client (Claude Code, Claude Desktop, and others as they adopt the protocol).

Defensibility rests on one bet: an open, portable, user-owned memory layer becomes infrastructure before the platforms lock people into proprietary memory. MCP — an open protocol the vendors already support — is what makes that bet credible.

---

## v1 Scope

**In:**
- A local MCP server exposing memory as tools.
- Local SQLite store (source of truth) with hybrid recall (keyword + semantic).
- Local embeddings — nothing leaves the machine.
- A local "inspect" web UI to read, edit, tag, and export memories (makes "you own it" visibly true).

**Out (deliberate YAGNI — defer until the core proves useful):**
- Encrypted cloud sync across devices (designed-for, built next — not a v1 blocker).
- Browser extension.
- Fully automatic capture of everything.
- Multi-user / teams.
- Memory-graph relationships beyond simple tags/links.

---

## Key Decisions

**Capture = hybrid (auto-propose + confirm).** The client's model proposes a memory ("want me to remember X?"), the user approves/edits, then it's saved. Low effort, user stays in control.

**Storage = local SQLite, source of truth.** Human-inspectable via the UI and an export. WAL mode on so the server and UI processes can share the file concurrently.

**Embeddings = local.** A small model (`bge-small` or `all-MiniLM-L6-v2`) via `fastembed-js`/`transformers.js`, behind an `Embedder` interface so an API backend can be swapped in later. Store the model name with each embedding to allow re-embedding on model change. Warm the model on server start.

**Vector search = brute-force cosine for v1.** A personal corpus is hundreds–low-thousands of entries; load embeddings from SQLite and score in JS. Combine with SQLite FTS5 for keyword. `sqlite-vec` is the scale-up path, not a v1 dependency (avoids native-extension loading cost on Windows).

**Cross-device portability** is achieved later via an end-to-end encrypted cloud replica where the user holds the keys. Local DB stays the source of truth.

---

## Architecture

Two separate processes sharing one SQLite file (`~/.engram/memory.db`, WAL mode):

1. **MCP server** (TypeScript, stdio transport) — registers tools, talks JSON-RPC to MCP clients.
2. **Inspect UI** (Next.js) — reads/writes the same DB directly; no API layer between the two needed for v1.

```
MCP client (Claude Code / Desktop)
        │  stdio / JSON-RPC
        ▼
   Engram MCP server ───┐
                        ├──►  ~/.engram/memory.db  (SQLite, WAL)
   Engram Inspect UI ───┘
   (Next.js, local)
```

---

## Data Model

`memory`
- `id` (uuid / autoincrement)
- `content` (text)
- `type` (e.g. fact | preference | project | reference)
- `tags` (JSON array, or a join table if relationships grow)
- `source` (which client/conversation it came from)
- `embedding` (blob)
- `embedding_model` (text)
- `created_at`, `updated_at`

FTS5 virtual table mirrors `content` for keyword search.

---

## MCP Tools

- `recall(query)` — hybrid keyword + semantic search; returns relevant memories.
- `save_memory(content, type, tags?)` — write a memory (dedupe near-identical content to avoid duplicates from the hybrid-capture flow).
- `list_memories(filter?)` — browse.
- `update_memory(id, ...)` — edit.
- `forget(id)` — delete.

---

## Build Order — prove the pipe, then fill it

1. **Scaffold + MCP skeleton with one stub tool** (`recall` returns a hardcoded result). Goal: get it _connecting_ inside an MCP client before building anything real behind it.
2. **Storage layer** — schema + `save`/`get` + FTS5 keyword search.
3. **Wire tool handlers** to storage — `save_memory` + keyword-only `recall`.
4. **Add embeddings** + hybrid (keyword + cosine) recall.
5. **Inspect UI** — reads the shared DB.

---

## Traps

- **stdio is the protocol channel** — never write logs to stdout (corrupts the JSON-RPC stream). Log to stderr only.
- Enable **WAL mode** at startup so both processes can share the DB.
- `better-sqlite3` is a native module; on Windows it usually fetches a prebuilt binary, but a fallback compile needs build tools.
- Keep embedding **dimensions consistent**; first model load is slow — warm it on start.
- Make `save_memory` **dedupe** near-identical content.

---

## Open Questions (post-v1)

- Monetization: the core is user-owned and local (hard to charge for). Likely business = optional hosted encrypted sync / team layer.
- Cold-start: bootstrap value by importing existing memory exports from other platforms so the store isn't empty on day one.
