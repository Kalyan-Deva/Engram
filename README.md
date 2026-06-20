# Engram

**Your memory, on your machine.**

Every AI platform is racing to build "memory" — and locking it inside their own
walls. Your context, preferences, and history end up trapped in one vendor's
product, invisible and unportable. Engram is the opposite bet: an open,
local-first memory layer that *you* own, that follows *you* across every tool.

Engram runs as a [Model Context Protocol](https://modelcontextprotocol.io)
server, so any MCP-capable client (Claude Code, Claude Desktop, and more as they
adopt the protocol) can read and write your memory. Everything stays on your
machine — the store, the search, even the embedding model. Nothing leaves.

### How it works
- **Local-first** — a single SQLite file on your disk is the source of truth.
- **On-device embeddings** — semantic search runs locally (bge-small); your
  memories are never sent to a third party.
- **Hybrid recall** — keyword (FTS5) fused with semantic similarity, so it finds
  what's *relevant*, not just what shares words.
- **Stays coherent** — flags related or contradicting memories on save instead
  of silently piling up duplicates.
- **You're in control** — a built-in inspect UI to browse, edit, tag, import,
  and export everything you've stored.

## Status

Early development. v1 is a local MCP server backed by SQLite, with hybrid (keyword + semantic) recall and local embeddings — nothing leaves your machine. See [`docs/plans`](docs/plans) for the design.

## Tools

| Tool             | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `recall`         | Search your memory for relevant entries            |
| `save_memory`    | Store a new memory                                 |
| `list_memories`  | Browse stored memories                             |
| `update_memory`  | Edit an existing memory                            |
| `forget`         | Delete a memory                                    |

## Development

```bash
npm install
npm run build
npm start
```

The server speaks over stdio. Point an MCP client (e.g. Claude Code or Claude Desktop) at the built `dist/index.js` to connect:

```bash
claude mcp add engram -- node C:\Dev\Engram\dist\index.js
```

### Inspect UI

A local web view to read, edit, tag, and export your memories lives in [`ui/`](ui):

```bash
cd ui
npm install
npm run dev
```

It reads the same store at `~/.engram/memory.db`. Memories added or edited here are re-embedded by the server on its next start.

## Storage

Everything lives in `~/.engram/` — `memory.db` (SQLite, source of truth) and `models/` (the local embedding model). Set `ENGRAM_DIR` to use a different location.

## License

MIT © Kalyan Gopalam
