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
        
        for (const primaryMesh of primaryMeshes) {
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
      const jitter = 0.85 + ((seed % 1000) / 1000) * 0.3; // 0.85-1.15

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
  // ── 東京 ──
  { lat: 35.681, lng: 139.767, coreDensity: 15000, radiusDeg: 0.25 },
  { lat: 35.710, lng: 139.820, coreDensity: 13000, radiusDeg: 0.12 },
  { lat: 35.610, lng: 139.720, coreDensity: 12000, radiusDeg: 0.10 },
  { lat: 35.750, lng: 139.680, coreDensity: 11000, radiusDeg: 0.10 },
  { lat: 35.670, lng: 139.630, coreDensity: 11000, radiusDeg: 0.10 },
  { lat: 35.698, lng: 139.414, coreDensity: 4000, radiusDeg: 0.08 },
  // ── 神奈川 ──
  { lat: 35.444, lng: 139.638, coreDensity: 12000, radiusDeg: 0.12 },
  { lat: 35.531, lng: 139.703, coreDensity: 11000, radiusDeg: 0.08 },
  { lat: 35.571, lng: 139.373, coreDensity: 5500, radiusDeg: 0.06 },
  // ── 埼玉 ──
  { lat: 35.862, lng: 139.646, coreDensity: 9000, radiusDeg: 0.10 },
  { lat: 35.808, lng: 139.724, coreDensity: 10000, radiusDeg: 0.05 },
  // ── 千葉 ──
  { lat: 35.607, lng: 140.106, coreDensity: 6500, radiusDeg: 0.08 },
  { lat: 35.695, lng: 139.983, coreDensity: 9000, radiusDeg: 0.06 },
  // ── 大阪 ──
  { lat: 34.694, lng: 135.502, coreDensity: 14000, radiusDeg: 0.15 },
  { lat: 34.770, lng: 135.470, coreDensity: 8000, radiusDeg: 0.08 },
  { lat: 34.573, lng: 135.483, coreDensity: 7000, radiusDeg: 0.08 },
  // ── 愛知 ──
  { lat: 35.181, lng: 136.907, coreDensity: 11000, radiusDeg: 0.15 },
  { lat: 34.769, lng: 137.392, coreDensity: 3500, radiusDeg: 0.05 },
  // ── 北海道 ──
  { lat: 43.062, lng: 141.354, coreDensity: 10000, radiusDeg: 0.12 },
  // ── 兵庫 ──
  { lat: 34.690, lng: 135.196, coreDensity: 9000, radiusDeg: 0.10 },
  { lat: 34.735, lng: 135.340, coreDensity: 10000, radiusDeg: 0.06 },
  // ── 京都 ──
  { lat: 35.012, lng: 135.768, coreDensity: 8000, radiusDeg: 0.10 },
  // ── 宮城 ──
  { lat: 38.268, lng: 140.869, coreDensity: 8500, radiusDeg: 0.10 },
  // ── 広島 ──
  { lat: 34.385, lng: 132.455, coreDensity: 8500, radiusDeg: 0.10 },
  // ── 岡山 ──
  { lat: 34.655, lng: 133.920, coreDensity: 5500, radiusDeg: 0.08 },
  // ── 新潟 ──
  { lat: 37.916, lng: 139.036, coreDensity: 4500, radiusDeg: 0.08 },
  // ── 静岡 ──
  { lat: 34.976, lng: 138.383, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 34.711, lng: 137.726, coreDensity: 4000, radiusDeg: 0.06 },
  // ── 四国 ──
  { lat: 33.839, lng: 132.766, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 34.340, lng: 134.043, coreDensity: 4000, radiusDeg: 0.05 },
  // ── 沖縄 ──
  { lat: 26.334, lng: 127.681, coreDensity: 8500, radiusDeg: 0.04 },

  // ══ 福岡県 全主要市町村 (国勢調査2020ベース) ══
  // 福岡市 (163万, DID密度~13,000/km²)
  { lat: 33.590, lng: 130.402, coreDensity: 13000, radiusDeg: 0.15 },
  { lat: 33.620, lng: 130.450, coreDensity: 6000, radiusDeg: 0.06 },
  { lat: 33.580, lng: 130.330, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.560, lng: 130.410, coreDensity: 8000, radiusDeg: 0.05 },
  // 北九州市 (94万)
  { lat: 33.884, lng: 130.875, coreDensity: 7500, radiusDeg: 0.10 },
  { lat: 33.870, lng: 130.760, coreDensity: 5000, radiusDeg: 0.08 },
  { lat: 33.942, lng: 130.959, coreDensity: 3000, radiusDeg: 0.03 },
  // 久留米 (30万)
  { lat: 33.319, lng: 130.509, coreDensity: 5000, radiusDeg: 0.06 },
  // 飯塚 (12.5万)
  { lat: 33.646, lng: 130.691, coreDensity: 3000, radiusDeg: 0.04 },
  // 大牟田 (11万)
  { lat: 33.030, lng: 130.446, coreDensity: 3500, radiusDeg: 0.04 },
  // 春日 (11.3万, 14km²)
  { lat: 33.533, lng: 130.471, coreDensity: 8000, radiusDeg: 0.03 },
  // 大野城 (10.2万)
  { lat: 33.537, lng: 130.487, coreDensity: 6500, radiusDeg: 0.03 },
  // 筑紫野 (10.5万)
  { lat: 33.496, lng: 130.515, coreDensity: 4000, radiusDeg: 0.04 },
  // 太宰府 (7.2万)
  { lat: 33.513, lng: 130.524, coreDensity: 4500, radiusDeg: 0.03 },
  // 宗像 (9.7万)
  { lat: 33.806, lng: 130.540, coreDensity: 3000, radiusDeg: 0.03 },
  // 古賀 (5.9万)
  { lat: 33.729, lng: 130.471, coreDensity: 3500, radiusDeg: 0.03 },
  // 福津 (6.7万)
  { lat: 33.770, lng: 130.490, coreDensity: 3000, radiusDeg: 0.03 },
  // 糸島 (10万)
  { lat: 33.557, lng: 130.197, coreDensity: 2500, radiusDeg: 0.03 },
  // 那珂川 (5万)
  { lat: 33.500, lng: 130.423, coreDensity: 3500, radiusDeg: 0.02 },
  // 粕屋 (4.8万)
  { lat: 33.612, lng: 130.482, coreDensity: 5000, radiusDeg: 0.02 },
  // 志免 (4.6万)
  { lat: 33.595, lng: 130.482, coreDensity: 6500, radiusDeg: 0.02 },
  // 直方 (5.5万)
  { lat: 33.744, lng: 130.730, coreDensity: 2500, radiusDeg: 0.03 },
  // 田川 (4.5万)
  { lat: 33.637, lng: 130.805, coreDensity: 2200, radiusDeg: 0.03 },
  // 行橋 (7.2万)
  { lat: 33.727, lng: 131.000, coreDensity: 3000, radiusDeg: 0.03 },
  // 中間 (3.8万, 16km²)
  { lat: 33.815, lng: 130.711, coreDensity: 4000, radiusDeg: 0.02 },
  // 小郡 (5.9万)
  { lat: 33.396, lng: 130.556, coreDensity: 3500, radiusDeg: 0.03 },
  // 柳川 (6.3万)
  { lat: 33.163, lng: 130.407, coreDensity: 2000, radiusDeg: 0.03 },
  // 朝倉 (4.9万)
  { lat: 33.421, lng: 130.666, coreDensity: 1500, radiusDeg: 0.03 },
  // 嘉麻 (3.5万)
  { lat: 33.567, lng: 130.723, coreDensity: 1200, radiusDeg: 0.03 },
  // 宮若 (2.6万)
  { lat: 33.720, lng: 130.665, coreDensity: 1000, radiusDeg: 0.02 },
  // みやま (3.5万)
  { lat: 33.154, lng: 130.474, coreDensity: 1200, radiusDeg: 0.02 },
  // 筑後 (4.8万)
  { lat: 33.210, lng: 130.502, coreDensity: 1800, radiusDeg: 0.02 },

  // ── その他九州 ──
  { lat: 33.249, lng: 130.299, coreDensity: 3000, radiusDeg: 0.05 }, // 佐賀
  { lat: 32.750, lng: 129.878, coreDensity: 5000, radiusDeg: 0.06 }, // 長崎
  { lat: 33.159, lng: 129.723, coreDensity: 3000, radiusDeg: 0.04 }, // 佐世保
  { lat: 32.803, lng: 130.708, coreDensity: 7000, radiusDeg: 0.10 }, // 熊本
  { lat: 33.238, lng: 131.613, coreDensity: 4500, radiusDeg: 0.06 }, // 大分
  { lat: 31.911, lng: 131.424, coreDensity: 3500, radiusDeg: 0.06 }, // 宮崎
  { lat: 31.597, lng: 130.557, coreDensity: 5000, radiusDeg: 0.08 }, // 鹿児島
  { lat: 33.959, lng: 130.942, coreDensity: 3000, radiusDeg: 0.04 }, // 下関
];

function estimateCellDensity(lat: number, lng: number): number {
  let best = 0;

  for (const city of CITY_DENSITY_POINTS) {
    const dLat = (lat - city.lat) * 111.32;
    const dLng = (lng - city.lng) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    const rKm = city.radiusDeg * 111.32;

    if (dist < rKm) {
      const v = city.coreDensity * Math.pow(1 - dist / rKm, 1.5);
      if (v > best) best = v;
    } else if (dist < rKm * 2.5) {
      const v = city.coreDensity * 0.15 * Math.pow(1 - (dist - rKm) / (rKm * 1.5), 2);
      if (v > best) best = v;
    }
  }

  if (best > 0) return Math.round(best);

  // Regional rural baseline
  if (lat > 41) return 15;                                           // 北海道
  if (lat > 37) return 60;                                           // 東北
  if (lat > 35 && lng > 138.5 && lng < 141) return 200;              // 関東平野
  if (lat > 34 && lat < 35.5 && lng > 134 && lng < 136.5) return 150; // 近畿
  if (lat > 33.3 && lat < 34 && lng > 130 && lng < 131.5) return 150; // 北部九州
  if (lat > 31 && lat < 33.5 && lng > 129.5 && lng < 132) return 80;  // 南九州
  if (lat > 24 && lat < 27) return 100;                               // 沖縄
  return 60;
}
