import { NextRequest, NextResponse } from "next/server";
import { HuffRequestSchema } from "@/types";
import { calculateHuff } from "@/lib/huff";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = HuffRequestSchema.parse(body);

    const result = calculateHuff(
      parsed.cells,
      parsed.stores,
      parsed.targetStoreId,
      parsed.alpha,
      parsed.beta
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
