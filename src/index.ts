#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  saveMemory,
  recall,
  listMemories,
  getMemory,
  updateMemory,
  forgetMemory,
  backfillEmbeddings,
  type Memory,
} from "./db.js";

/**
 * Engram MCP server.
 *
 * stdio is the JSON-RPC channel between this server and the MCP client.
 * NEVER write to stdout (console.log) — it corrupts the protocol stream.
 * All diagnostics go to stderr via `log()`.
 */
function log(message: string): void {
  process.stderr.write(`[engram] ${message}\n`);
}

const memoryType = z.enum(["fact", "preference", "project", "reference"]);

function formatMemory(m: Memory): string {
  const tags = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
  return `#${m.id} (${m.type})${tags}: ${m.content}`;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const server = new McpServer({ name: "engram", version: "0.1.0" });

server.registerTool(
  "recall",
  {
    title: "Recall memories",
    description:
      "Search the user's personal memory for entries relevant to a query. " +
      "Call this whenever earlier context about the user would help.",
    inputSchema: {
      query: z.string().describe("What to search the user's memory for."),
      limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)."),
    },
  },
  async ({ query, limit }) => {
    const results = await recall(query, limit ?? 10);
    log(`recall(${JSON.stringify(query)}) -> ${results.length}`);
    if (results.length === 0) return textResult(`No memories found for "${query}".`);
    return textResult(results.map(formatMemory).join("\n"));
  },
);

server.registerTool(
  "save_memory",
  {
    title: "Save a memory",
    description:
      "Store a durable fact about the user (a preference, an ongoing project, a " +
      "reference, etc.). Propose this to the user and save once confirmed. " +
      "Identical content is deduped automatically.",
    inputSchema: {
      content: z.string().describe("The fact to remember, in a self-contained sentence."),
      type: memoryType.optional().describe("Category (default 'fact')."),
      tags: z.array(z.string()).optional().describe("Optional tags for grouping."),
      source: z.string().optional().describe("Where this came from (client/conversation)."),
    },
  },
  async ({ content, type, tags, source }) => {
    const saved = await saveMemory({ content, type, tags, source });
    log(`save_memory -> #${saved.id}`);
    return textResult(`Saved ${formatMemory(saved)}`);
  },
);

server.registerTool(
  "list_memories",
  {
    title: "List memories",
    description: "Browse stored memories, most recently updated first.",
    inputSchema: {
      type: memoryType.optional().describe("Filter by category."),
      limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)."),
    },
  },
  async ({ type, limit }) => {
    const results = listMemories({ type, limit });
    if (results.length === 0) return textResult("No memories stored yet.");
    return textResult(results.map(formatMemory).join("\n"));
  },
);

server.registerTool(
  "update_memory",
  {
    title: "Update a memory",
    description: "Edit an existing memory by id.",
    inputSchema: {
      id: z.number().int().positive().describe("The memory id (e.g. from recall/list)."),
      content: z.string().optional().describe("New content."),
      type: memoryType.optional().describe("New category."),
      tags: z.array(z.string()).optional().describe("New tags (replaces existing)."),
    },
  },
  async ({ id, content, type, tags }) => {
    const updated = await updateMemory(id, { content, type, tags });
    if (!updated) return textResult(`No memory #${id}.`);
    log(`update_memory -> #${id}`);
    return textResult(`Updated ${formatMemory(updated)}`);
  },
);

server.registerTool(
  "forget",
  {
    title: "Forget a memory",
    description: "Permanently delete a memory by id.",
    inputSchema: {
      id: z.number().int().positive().describe("The memory id to delete."),
    },
  },
  async ({ id }) => {
    const m = getMemory(id);
    const ok = forgetMemory(id);
    log(`forget(#${id}) -> ${ok}`);
    return textResult(ok ? `Forgot #${id}: ${m?.content ?? ""}` : `No memory #${id}.`);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server started on stdio");
  // Warm the embedder and heal any missing vectors (e.g. UI-added memories)
  // in the background so startup isn't blocked.
  backfillEmbeddings()
    .then((n) => {
      if (n > 0) log(`backfilled ${n} embedding(s)`);
    })
    .catch(() => {});
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
