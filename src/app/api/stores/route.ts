import { NextRequest, NextResponse } from "next/server";
import { StoreCreateSchema } from "@/types";
import type { Store } from "@/types";
import { calculateAttractiveness } from "@/lib/attractiveness";

// In-memory fallback when Vercel KV is not available
let memoryStore: Store[] = [];
let useMemory = false;

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      useMemory = true;
      return null;
    }
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    useMemory = true;
    return null;
  }
}

async function getAllStores(): Promise<Store[]> {
  const kv = await getKv();
  if (!kv || useMemory) return memoryStore;

  try {
    const stores = await kv.get<Store[]>("stores");
    return stores || [];
  } catch {
    useMemory = true;
    return memoryStore;
  }
}

async function saveAllStores(stores: Store[]): Promise<void> {
  const kv = await getKv();
  if (!kv || useMemory) {
    memoryStore = stores;
    return;
  }
  try {
    await kv.set("stores", stores);
  } catch {
    useMemory = true;
    memoryStore = stores;
  }
}

// GET: List all stores
export async function GET() {
  try {
    const stores = await getAllStores();
    const { stores: withScores, warnings } = calculateAttractiveness(stores);
    return NextResponse.json({ stores: withScores, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create a store
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = StoreCreateSchema.parse(body);

    const stores = await getAllStores();

    const newStore: Store = {
      id: `store_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...parsed,
      attractiveness: null,
    };

    stores.push(newStore);

    // Recalculate attractiveness for all stores
    const { stores: withScores } = calculateAttractiveness(stores);
    await saveAllStores(withScores);

    return NextResponse.json({ store: withScores.find((s) => s.id === newStore.id) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE: Remove a store
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    let stores = await getAllStores();
    stores = stores.filter((s) => s.id !== id);

    const { stores: withScores } = calculateAttractiveness(stores);
    await saveAllStores(withScores);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
