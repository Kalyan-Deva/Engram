# Engram

A local-first personal memory server that any MCP client plugs into — so your context, preferences, and history follow **you** across apps instead of living inside one vendor's walls.

Your memory lives on your machine, in a store you control, exposed over the [Model Context Protocol](https://modelcontextprotocol.io) so it works across every MCP-capable client.

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
