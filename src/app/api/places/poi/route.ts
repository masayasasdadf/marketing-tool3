import { NextRequest, NextResponse } from "next/server";
import { FacilityRequestSchema } from "@/types";
import { facilityCategory } from "@/lib/geo";

const DEFAULT_TYPES = [
  "shopping_mall",
  "supermarket",
  "train_station",
  "hospital",
  "school",
  "city_hall",
];

const TYPE_TO_GOOGLE: Record<string, string> = {
  shopping_mall: "shopping_mall",
  supermarket: "supermarket",
  train_station: "train_station",
  hospital: "hospital",
  school: "school",
  city_hall: "city_hall",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = FacilityRequestSchema.parse(body);

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const types = parsed.types || DEFAULT_TYPES;
    const allFacilities: Record<string, unknown>[] = [];

    for (const fType of types) {
      const googleType = TYPE_TO_GOOGLE[fType] || fType;
      const url = new URL(
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
      );
      url.searchParams.set("location", `${parsed.lat},${parsed.lng}`);
      url.searchParams.set("radius", String(parsed.radiusKm * 1000));
      url.searchParams.set("type", googleType);
      url.searchParams.set("language", "ja");
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();

      if (data.status === "OK") {
        for (const place of data.results) {
          allFacilities.push({
            placeId: place.place_id,
            name: place.name,
            lat: place.geometry?.location?.lat,
            lng: place.geometry?.location?.lng,
            type: fType,
            category: facilityCategory(fType),
          });
        }
      }
    }

    return NextResponse.json({ facilities: allFacilities });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
