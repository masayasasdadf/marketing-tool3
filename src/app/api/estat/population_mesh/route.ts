import { NextRequest, NextResponse } from "next/server";
import { PopulationMeshRequestSchema } from "@/types";
import type { PopulationCell } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = PopulationMeshRequestSchema.parse(body);

    const appId = process.env.ESTAT_APP_ID;
    if (!appId) {
      return NextResponse.json(
        { error: "ESTAT_APP_ID is not configured" },
        { status: 500 }
      );
    }

    const latDelta = parsed.radiusKm / 111.32;
    const lngDelta =
      parsed.radiusKm / (111.32 * Math.cos((parsed.lat * Math.PI) / 180));

    const minLat = parsed.lat - latDelta;
    const maxLat = parsed.lat + latDelta;
    const minLng = parsed.lng - lngDelta;
    const maxLng = parsed.lng + lngDelta;

    const cells: PopulationCell[] = [];
    let isEstimate = false;

    // Generate mesh codes for the area
    const meshCodes = generateMeshCodes(minLat, maxLat, minLng, maxLng);

    if (meshCodes.length === 0) {
      return NextResponse.json({
        cells: [],
        summary: { total: 0, average: 0, max: 0, cellCount: 0 },
        isEstimate: true,
      });
    }

    // Get unique primary mesh codes (1次メッシュ: first 4 digits)
    const primaryMeshes = [...new Set(meshCodes.map((c) => c.slice(0, 4)))];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Try multiple known statsDataIds for mesh population data
    // 国勢調査 地域メッシュ統計 (Census mesh statistics)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const MESH_STATS_IDS = [
      "T001100",     // 2020 国勢調査 4次メッシュ(500m) 人口等基本集計
      "T000846",     // 2015 国勢調査 メッシュ 人口等基本集計
      "0003448237",  // Legacy ID - may also work
    ];

    let dataFetched = false;

    for (const statsDataId of MESH_STATS_IDS) {
      if (dataFetched) break;

      for (const primaryMesh of primaryMeshes.slice(0, 5)) {
        const meshUrl = new URL(
          "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
        );
        meshUrl.searchParams.set("appId", appId);
        meshUrl.searchParams.set("statsDataId", statsDataId);
        // FIX: Use cdMesh instead of cdArea for mesh-level data
        meshUrl.searchParams.set("cdMesh", primaryMesh);
        meshUrl.searchParams.set("sectionHeaderFlg", "2");
        meshUrl.searchParams.set("limit", "10000");

        try {
          const res = await fetch(meshUrl.toString());
          const data = await res.json();

          // Check for API errors
          const status =
            data?.GET_STATS_DATA?.RESULT?.STATUS;
          if (status !== undefined && status !== 0) {
            // This statsDataId didn't work, try next one
            continue;
          }

          const values =
            data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

          if (!Array.isArray(values) || values.length === 0) {
            continue;
          }

          // ──────────────────────────────────────────────────
          // Parse mesh population data from e-Stat response
          // ──────────────────────────────────────────────────
          // In e-Stat mesh data:
          //   @area  = mesh code (8-digit for 1km mesh, longer for 500m)
          //   @cat01 = category code (e.g., total pop, male, female, etc.)
          //   @tab   = table header code
          //   @time  = time period code
          //   $      = the actual value
          //
          // We need to:
          //  1. Group by mesh code (@area)
          //  2. Pick only total population (usually the first/largest cat01 value,
          //     or the one with @cat01 ending in "00010" or containing "総数")
          // ──────────────────────────────────────────────────

          // First pass: find the cat01 code for total population
          const totalPopCat = findTotalPopulationCategory(values);

          // Second pass: extract population per mesh code
          const meshPopMap = new Map<string, number>();

          for (const v of values) {
            const meshCode = v["@area"] || "";
            const catCode = v["@cat01"] || "";
            const rawValue = v["$"];

            // Skip if not the total population category
            if (totalPopCat && catCode !== totalPopCat) continue;

            // Skip entries without a valid mesh code
            if (!meshCode || meshCode.length < 6) continue;

            const population = parseInt(rawValue || "0", 10);
            if (isNaN(population) || population < 0) continue;

            // Skip obviously wrong values (single mesh cell > 50,000 is suspicious)
            if (population > 50000) continue;

            // Use the largest value per mesh code if duplicates exist
            const existing = meshPopMap.get(meshCode) || 0;
            if (population > existing) {
              meshPopMap.set(meshCode, population);
            }
          }

          for (const [meshCode, population] of meshPopMap) {
            const coords = meshCodeToLatLng(meshCode);
            if (!coords) continue;

            if (
              coords.lat >= minLat &&
              coords.lat <= maxLat &&
              coords.lng >= minLng &&
              coords.lng <= maxLng
            ) {
              cells.push({
                lat: coords.lat,
                lng: coords.lng,
                population,
                meshCode,
              });
            }
          }

          if (cells.length > 0) {
            dataFetched = true;
          }
        } catch {
          // Continue to next mesh/statsDataId
        }
      }
    }

    // If e-Stat returned no data, generate per-cell density estimates
    if (cells.length === 0) {
      isEstimate = true;
      const estimatedCells = estimatePopulationGrid(
        parsed.lat,
        parsed.lng,
        parsed.radiusKm
      );
      cells.push(...estimatedCells);
    }

    const populations = cells.map((c) => c.population);
    const total = populations.reduce((a, b) => a + b, 0);
    const average = cells.length > 0 ? Math.round(total / cells.length) : 0;
    const max = cells.length > 0 ? Math.max(...populations) : 0;

    return NextResponse.json({
      cells,
      summary: { total, average, max, cellCount: cells.length },
      isEstimate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Find the category code (@cat01) that represents total population.
 *
 * Strategy:
 * 1. Look for a cat01 with name containing "総数" or "人口総数"
 * 2. If sectionHeaderFlg=2 is not providing names, look for the first cat01
 *    value (which is typically total population in census data)
 * 3. If there's only one unique cat01, use it directly
 */
function findTotalPopulationCategory(
  values: Record<string, string>[]
): string | null {
  const catCodes = new Set<string>();
  const catNames = new Map<string, string>();

  for (const v of values) {
    const cat = v["@cat01"] || "";
    if (cat) {
      catCodes.add(cat);
      // Some responses include a name field
      const name = v["@cat01_name"] || "";
      if (name) catNames.set(cat, name);
    }
  }

  // If there's only one category, use it
  if (catCodes.size === 1) {
    return [...catCodes][0];
  }

  // Look for category with "総数" (total) in the name
  for (const [code, name] of catNames) {
    if (
      name.includes("総数") ||
      name.includes("人口総数") ||
      name.includes("total")
    ) {
      return code;
    }
  }

  // Common patterns: first cat code alphabetically/numerically is total
  // In census data, the total population category typically has the
  // smallest or first code (e.g., "A1101", "00010", etc.)
  const sorted = [...catCodes].sort();
  if (sorted.length > 0) {
    return sorted[0];
  }

  return null;
}

function generateMeshCodes(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): string[] {
  const codes: string[] = [];
  // Step by 3rd-level mesh (approximately 1km)
  for (let lat = minLat; lat <= maxLat; lat += 0.008333) {
    for (let lng = minLng; lng <= maxLng; lng += 0.0125) {
      const code = latLngToMeshCode(lat, lng);
      if (code && !codes.includes(code)) {
        codes.push(code);
      }
    }
  }
  return codes;
}

function latLngToMeshCode(lat: number, lng: number): string | null {
  try {
    const p = lat * 1.5;
    const a = Math.floor(p);
    const q = lng - 100;
    const b = Math.floor(q);

    const pr = (p - a) * 8;
    const c = Math.floor(pr);
    const qr = (q - b) * 8;
    const d = Math.floor(qr);

    const pr2 = (pr - c) * 10;
    const e = Math.floor(pr2);
    const qr2 = (qr - d) * 10;
    const f = Math.floor(qr2);

    return `${a}${b}${c}${d}${e}${f}`;
  } catch {
    return null;
  }
}

function meshCodeToLatLng(code: string): { lat: number; lng: number } | null {
  if (code.length < 6) return null;
  try {
    const a = parseInt(code.slice(0, 2), 10);
    const b = parseInt(code.slice(2, 4), 10);
    const c = parseInt(code.slice(4, 5), 10);
    const d = parseInt(code.slice(5, 6), 10);

    let lat = a / 1.5 + c / 12;
    let lng = b + 100 + d / 8;

    if (code.length >= 8) {
      const e = parseInt(code.slice(6, 7), 10);
      const f = parseInt(code.slice(7, 8), 10);
      lat += e / 120;
      lng += f / 80;
    }

    // Center of the mesh cell
    if (code.length <= 6) {
      // 2次メッシュ: center offset
      lat += 1 / 24;
      lng += 1 / 16;
    } else if (code.length <= 8) {
      // 3次メッシュ (1km): center offset
      lat += 1 / 240;
      lng += 1 / 160;
    } else {
      // 4次メッシュ (500m) or finer
      // Handle 9-digit codes (half-mesh / 500m)
      if (code.length >= 9) {
        const subdivision = parseInt(code.slice(8, 9), 10);
        // 500m mesh subdivides 1km mesh into 4 quadrants:
        // 1=SW, 2=SE, 3=NW, 4=NE
        if (subdivision === 1) {
          // SW quadrant - no additional offset needed
        } else if (subdivision === 2) {
          // SE quadrant
          lng += 1 / 160;
        } else if (subdivision === 3) {
          // NW quadrant
          lat += 1 / 240;
        } else if (subdivision === 4) {
          // NE quadrant
          lat += 1 / 240;
          lng += 1 / 160;
        }
      }
      // Center of sub-cell
      lat += 1 / 480;
      lng += 1 / 320;
    }

    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Estimate population grid when e-Stat mesh data is unavailable.
 *
 * Uses average population density data from known Japanese cities.
 * This is a rough fallback and should be clearly marked as an estimate.
 *
 * 500m mesh cell ≈ 0.25 km²
 */
function estimatePopulationGrid(
  centerLat: number,
  centerLng: number,
  radiusKm: number
): PopulationCell[] {
  const cells: PopulationCell[] = [];

  const latStep = 0.004167; // ~500m
  const lngStep = 0.00625; // ~500m
  const cellAreaKm2 = 0.25;

  const latDelta = radiusKm / 111.32;
  const lngDelta =
    radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));

  let seed = Math.abs(
    Math.floor(centerLat * 10000 + centerLng * 10000)
  );

  for (
    let lat = centerLat - latDelta;
    lat <= centerLat + latDelta;
    lat += latStep
  ) {
    for (
      let lng = centerLng - lngDelta;
      lng <= centerLng + lngDelta;
      lng += lngStep
    ) {
      const dist = Math.sqrt(
        Math.pow((lat - centerLat) * 111.32, 2) +
          Math.pow(
            (lng - centerLng) *
              111.32 *
              Math.cos((centerLat * Math.PI) / 180),
            2
          )
      );
      if (dist > radiusKm) continue;

      // Evaluate density AT THIS CELL's coordinates
      const density = estimateCellDensity(lat, lng);
      const baseCellPop = Math.round(density * cellAreaKm2);

      if (baseCellPop <= 0) {
        cells.push({
          lat: Math.round(lat * 100000) / 100000,
          lng: Math.round(lng * 100000) / 100000,
          population: 0,
          meshCode: latLngToMeshCode(lat, lng) || "",
        });
        continue;
      }

      // Small jitter for visual variety
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const jitter = 0.7 + ((seed % 1000) / 1000) * 0.6; // 0.7-1.3

      const population = Math.max(0, Math.round(baseCellPop * jitter));

      cells.push({
        lat: Math.round(lat * 100000) / 100000,
        lng: Math.round(lng * 100000) / 100000,
        population,
        meshCode: latLngToMeshCode(lat, lng) || "",
      });
    }
  }

  return cells;
}

// ─── Known city centers with radius and density ───
interface CityDensityPoint {
  lat: number;
  lng: number;
  coreDensity: number; // people/km² at center
  radiusDeg: number; // approximate urban extent in degrees (~1 deg ≈ 111km)
}

const CITY_DENSITY_POINTS: CityDensityPoint[] = [
  // Tokyo
  { lat: 35.6812, lng: 139.7671, coreDensity: 15000, radiusDeg: 0.15 },
  // Tokyo suburbs
  { lat: 35.73, lng: 139.65, coreDensity: 8000, radiusDeg: 0.08 },
  { lat: 35.63, lng: 139.65, coreDensity: 8000, radiusDeg: 0.08 },
  { lat: 35.68, lng: 139.85, coreDensity: 5000, radiusDeg: 0.06 },
  // Yokohama
  { lat: 35.4437, lng: 139.638, coreDensity: 8600, radiusDeg: 0.1 },
  // Osaka
  { lat: 34.6937, lng: 135.5023, coreDensity: 12000, radiusDeg: 0.12 },
  // Nagoya
  { lat: 35.1815, lng: 136.9066, coreDensity: 7000, radiusDeg: 0.1 },
  // Sapporo
  { lat: 43.0621, lng: 141.3544, coreDensity: 4200, radiusDeg: 0.08 },
  // Fukuoka
  { lat: 33.5902, lng: 130.4017, coreDensity: 4600, radiusDeg: 0.06 },
  // Kobe
  { lat: 34.6901, lng: 135.1956, coreDensity: 4000, radiusDeg: 0.06 },
  // Kyoto
  { lat: 35.0116, lng: 135.7681, coreDensity: 3500, radiusDeg: 0.06 },
  // Kawasaki
  { lat: 35.5309, lng: 139.703, coreDensity: 10000, radiusDeg: 0.05 },
  // Saitama
  { lat: 35.8617, lng: 139.6455, coreDensity: 6000, radiusDeg: 0.06 },
  // Hiroshima
  { lat: 34.3853, lng: 132.4553, coreDensity: 3800, radiusDeg: 0.06 },
  // Sendai
  { lat: 38.2682, lng: 140.8694, coreDensity: 3500, radiusDeg: 0.06 },
  // Kitakyushu
  { lat: 33.8835, lng: 130.8752, coreDensity: 2500, radiusDeg: 0.06 },
  // Chiba
  { lat: 35.6073, lng: 140.1063, coreDensity: 3600, radiusDeg: 0.05 },
  // Kumamoto
  { lat: 32.8032, lng: 130.7079, coreDensity: 2000, radiusDeg: 0.05 },
  // Kagoshima
  { lat: 31.5966, lng: 130.5571, coreDensity: 1800, radiusDeg: 0.04 },
  // Naha
  { lat: 26.3344, lng: 127.8015, coreDensity: 8000, radiusDeg: 0.03 },
  // Okayama
  { lat: 34.6551, lng: 133.9195, coreDensity: 2000, radiusDeg: 0.04 },
  // Niigata
  { lat: 37.9161, lng: 139.0364, coreDensity: 1800, radiusDeg: 0.04 },
  // Hamamatsu
  { lat: 34.7108, lng: 137.7261, coreDensity: 1500, radiusDeg: 0.04 },
  // Sagamihara
  { lat: 35.5713, lng: 139.3734, coreDensity: 4000, radiusDeg: 0.04 },
  // Matsuyama
  { lat: 33.8392, lng: 132.7657, coreDensity: 1500, radiusDeg: 0.04 },
  // Kurume
  { lat: 33.319, lng: 130.5088, coreDensity: 1200, radiusDeg: 0.03 },
  // Saga
  { lat: 33.2494, lng: 130.2988, coreDensity: 1000, radiusDeg: 0.03 },
  // Sasebo
  { lat: 33.1593, lng: 129.7228, coreDensity: 800, radiusDeg: 0.03 },
];

/**
 * Estimate population density for a SINGLE CELL based on its coordinates.
 */
function estimateCellDensity(lat: number, lng: number): number {
  let maxContribution = 0;

  for (const city of CITY_DENSITY_POINTS) {
    const d = Math.sqrt(
      Math.pow((lat - city.lat) * 111.32, 2) +
        Math.pow(
          (lng - city.lng) * 111.32 * Math.cos((lat * Math.PI) / 180),
          2
        )
    );
    const radiusKm = city.radiusDeg * 111.32;

    if (d < radiusKm) {
      const ratio = d / radiusKm;
      const contribution = city.coreDensity * Math.pow(1 - ratio, 1.5);
      maxContribution = Math.max(maxContribution, contribution);
    } else if (d < radiusKm * 2) {
      const ratio = (d - radiusKm) / radiusKm;
      const contribution = city.coreDensity * 0.1 * (1 - ratio);
      maxContribution = Math.max(maxContribution, contribution);
    }
  }

  if (maxContribution > 0) {
    return Math.round(maxContribution);
  }

  return 20;
}
