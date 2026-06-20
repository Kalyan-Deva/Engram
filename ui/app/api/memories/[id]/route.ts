import { NextRequest, NextResponse } from "next/server";
import { updateMemory, deleteMemory, type MemoryType } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    content?: string;
    type?: MemoryType;
    tags?: string[];
  };
  const memory = updateMemory(Number(id), body);
  if (!memory) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ memory });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = deleteMemory(Number(id));
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
