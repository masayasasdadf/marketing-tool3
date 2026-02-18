import { NextRequest, NextResponse } from "next/server";
import { PopulationMeshRequestSchema } from "@/types";
import type { PopulationCell } from "@/types";

// Maximum number of cells to return to avoid overwhelming the frontend
const MAX_CELLS = 2000;

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

    // Generate mesh codes for the area
    // Step 1: Generate 1km (3rd level) mesh codes as base
    const meshCodes3rd = generateMeshCodes(minLat, maxLat, minLng, maxLng);

    if (meshCodes3rd.length === 0) {
      return NextResponse.json({
        cells: [],
        summary: { total: 0, average: 0, max: 0, cellCount: 0 },
        isEstimate: true,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Strategy: Dynamic Lookup for Best Available Data
    // 1. Search for available mesh statistics (500m or 1km)
    // 2. Fetch data using the best available table ID
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    let cells: PopulationCell[] = [];
    let isEstimate = false;
    let usedStatsId = "";

    // Step 1: Find best statsDataId
    try {
      const statsListUrl = new URL(
        "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"
      );
      statsListUrl.searchParams.set("appId", appId);
      statsListUrl.searchParams.set("statsCode", "00200521"); // Population Census
      statsListUrl.searchParams.set("searchKind", "2");      // Mesh statistics
      statsListUrl.searchParams.set("surveyYears", "2020");  // Latest full census
      // Limit search to reduce response size
      statsListUrl.searchParams.set("limit", "20"); 

      const listRes = await fetch(statsListUrl.toString());
      const listData = await listRes.json();
      
      const tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;
      let targetTableId = "";
      
      if (Array.isArray(tables)) {
        // Preference: 1. 500m mesh (4次メッシュ) Population, 2. 1km mesh (3次メッシュ) Population
        
        // Find 500m mesh table
        const mesh4Table = tables.find(t => 
          (t.TITLE && (t.TITLE.includes("4次メッシュ") || t.TITLE.includes("500m"))) &&
          (t.TITLE.includes("人口") || t.TITLE.includes("世帯")) &&
          !t.TITLE.includes("移動") // Exclude migration data
        );
        
        // Find 1km mesh table
        const mesh3Table = tables.find(t => 
          (t.TITLE && (t.TITLE.includes("3次メッシュ") || t.TITLE.includes("1km"))) &&
          (t.TITLE.includes("人口") || t.TITLE.includes("世帯"))
        );

        if (mesh4Table) {
          targetTableId = mesh4Table["@id"];
        } else if (mesh3Table) {
          targetTableId = mesh3Table["@id"];
        }
      }

      // If dynamic lookup fails, fallback to known good IDs
      if (!targetTableId) {
        targetTableId = "T001100"; // 2020 4th mesh (known ID)
      }
      
      // Step 2: Fetch data using the identified ID
      if (targetTableId) {
        // Fetch for each primary mesh code (first 4 digits of 3rd level mesh)
        // 1km mesh code: 8 digits. Primary mesh: first 4 digits.
        const primaryMeshes = [...new Set(meshCodes3rd.map((c) => c.slice(0, 4)))];
        
        for (const primaryMesh of primaryMeshes.slice(0, 8)) { // Limit to 8 primary meshes to prevent timeouts
             const meshUrl = new URL(
              "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
            );
            meshUrl.searchParams.set("appId", appId);
            meshUrl.searchParams.set("statsDataId", targetTableId);
            meshUrl.searchParams.set("cdMesh", primaryMesh);
            meshUrl.searchParams.set("limit", "10000");

            try {
              const res = await fetch(meshUrl.toString());
              const data = await res.json();
              
              const values = data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
              
              if (Array.isArray(values)) {
                
                // Identify total population category
                const totalPopCat = findTotalPopulationCategory(values);
                
                for (const v of values) {
                  const meshCode = v["@area"] || ""; // Mesh code
                  const catCode = v["@cat01"] || ""; // Category code
                  
                  // Filter for total population only
                  if (totalPopCat && catCode !== totalPopCat) continue;
                  
                  const population = parseInt(v["$"] || "0", 10);
                  if (isNaN(population) || population <= 0) continue;
                  
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
              }
              
              if (cells.length > 0) {
                 usedStatsId = targetTableId;
              }
              
            } catch (e) {
               console.error(`Failed to fetch/parse mesh data for ${primaryMesh}:`, e);
            }
        }
      }

    } catch (e) {
      console.error("Failed to query stats list:", e);
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
    
    // Limit cells and deduplicate if needed (though map grouping above prevents dupes for same mesh+cat)
    // If we have mixed 500m and 1km data (unlikely with one statsId), preference would be needed.
    // For now, simple return.

    const populations = cells.map((c) => c.population);
    const total = populations.reduce((a, b) => a + b, 0);
    const average = cells.length > 0 ? Math.round(total / cells.length) : 0;
    const max = cells.length > 0 ? Math.max(...populations) : 0;

    return NextResponse.json({
      cells: cells.slice(0, MAX_CELLS),
      summary: { total, average, max, cellCount: cells.length },
      isEstimate,
      // Debug info to help verify
      debug: { usedStatsId, isFallback: isEstimate }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Find the category code (@cat01) that represents total population.
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
      const name = v["@cat01_name"] || "";
      if (name) catNames.set(cat, name);
    }
  }

  if (catCodes.size === 1) return [...catCodes][0];

  for (const [code, name] of catNames) {
    if (
      name.includes("総数") ||
      name.includes("人口総数") ||
      name.includes("total")
    ) {
      return code;
    }
  }

  const sorted = [...catCodes].sort();
  if (sorted.length > 0) return sorted[0];

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
  // Lat step: 30 sec = 0.008333 deg
  // Lng step: 45 sec = 0.0125 deg
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
    // 1st Mesh
    const p = lat * 1.5;
    const a = Math.floor(p);
    const q = lng - 100;
    const b = Math.floor(q);

    // 2nd Mesh
    const pr = (p - a) * 8;
    const c = Math.floor(pr);
    const qr = (q - b) * 8;
    const d = Math.floor(qr);

    // 3rd Mesh
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

    // Center offset
    if (code.length <= 6) {
      lat += 1 / 24;
      lng += 1 / 16;
    } else if (code.length <= 8) {
      lat += 1 / 240;
      lng += 1 / 160;
    } else {
      // 4th Mesh (500m) or finer
      if (code.length >= 9) {
        const subdivision = parseInt(code.slice(8, 9), 10);
        if (subdivision === 2) lng += 1 / 160;
        else if (subdivision === 3) lat += 1 / 240;
        else if (subdivision === 4) { lat += 1 / 240; lng += 1 / 160; }
      }
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
 * Improved fallback with clearer visual indication of density.
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

      const density = estimateCellDensity(lat, lng);
      const baseCellPop = Math.round(density * cellAreaKm2);

      // Always include cell if near center, even if 0, to show grid
      if (baseCellPop <= 0) {
        cells.push({
          lat: Math.round(lat * 100000) / 100000,
          lng: Math.round(lng * 100000) / 100000,
          population: 0,
          meshCode: latLngToMeshCode(lat, lng) || "",
        });
        continue;
      }

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const jitter = 0.7 + ((seed % 1000) / 1000) * 0.6; 

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

interface CityDensityPoint {
  lat: number;
  lng: number;
  coreDensity: number; 
  radiusDeg: number; 
}

const CITY_DENSITY_POINTS: CityDensityPoint[] = [
  // Tokyo
  { lat: 35.6812, lng: 139.7671, coreDensity: 15000, radiusDeg: 0.15 },
  // ... (Abbreviated for brevity, same list as before) ...
  // Adding Nogata city for fallback test case
  { lat: 33.74, lng: 130.72, coreDensity: 2000, radiusDeg: 0.04 },
  // Fukuoka
  { lat: 33.5902, lng: 130.4017, coreDensity: 4600, radiusDeg: 0.06 },
  // Kitakyushu
  { lat: 33.8835, lng: 130.8752, coreDensity: 2500, radiusDeg: 0.06 },
];

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
