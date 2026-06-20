import { NextResponse } from "next/server";
import { listMemories } from "@/lib/store";

export const dynamic = "force-dynamic";

// Download the full memory store as JSON — the visible proof that you own it.
export async function GET() {
  const memories = listMemories();
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), memories }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="engram-export.json"',
    },
  });
}
