import { NextRequest, NextResponse } from "next/server";
import { listMemories, searchMemories, createMemory, type MemoryType } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const memories = q ? searchMemories(q) : listMemories();
  return NextResponse.json({ memories });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    content?: string;
    type?: MemoryType;
    tags?: string[];
  };
  if (!body.content || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const memory = createMemory({
    content: body.content,
    type: body.type,
    tags: body.tags,
  });
  return NextResponse.json({ memory }, { status: 201 });
}
