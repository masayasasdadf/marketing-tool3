import { NextRequest, NextResponse } from "next/server";
import { CompetitorRequestSchema } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CompetitorRequestSchema.parse(body);

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    );
    url.searchParams.set("location", `${parsed.lat},${parsed.lng}`);
    url.searchParams.set("radius", String(parsed.radiusKm * 1000));
    url.searchParams.set("keyword", parsed.query);
    url.searchParams.set("language", "ja");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return NextResponse.json(
        { error: `Google Places API error: ${data.status}`, detail: data.error_message },
        { status: 502 }
      );
    }

    const competitors = (data.results || []).map((place: Record<string, unknown>) => ({
      placeId: place.place_id,
      name: place.name,
      lat: (place.geometry as Record<string, Record<string, number>>)?.location?.lat,
      lng: (place.geometry as Record<string, Record<string, number>>)?.location?.lng,
      rating: place.rating ?? null,
      reviewCount: (place.user_ratings_total as number) ?? 0,
      address: place.vicinity ?? "",
      googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    }));

    return NextResponse.json({ competitors });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
