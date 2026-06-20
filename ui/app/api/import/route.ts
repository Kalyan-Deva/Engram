import { NextRequest, NextResponse } from "next/server";
import { parseImportText, importMemories, type ImportItem } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { text?: string; items?: ImportItem[] };
  const items = body.items ?? parseImportText(body.text ?? "");
  if (items.length === 0) {
    return NextResponse.json({ error: "nothing to import" }, { status: 400 });
  }
  const result = importMemories(items);
  return NextResponse.json(result);
}
