import { NextRequest, NextResponse } from "next/server";
import { PopulationMeshRequestSchema } from "@/types";
import type { PopulationCell } from "@/types";

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

    const meshCodes3rd = generateMeshCodes(minLat, maxLat, minLng, maxLng);

    if (meshCodes3rd.length === 0) {
      return NextResponse.json({
        cells: [],
        summary: { total: 0, average: 0, max: 0, cellCount: 0 },
        isEstimate: true,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Strategy:
    // 1. Dynamic lookup for best mesh stats table ID
    // 2. Fetch real census data per primary mesh
    // 3. Fallback to estimation ONLY if API returns nothing
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const cellMap = new Map<string, PopulationCell>();
    let isEstimate = false;
    let usedStatsId = "";
    let debugInfo: Record<string, unknown> = {};

    // Step 1: Find best statsDataId via getStatsList
    let targetTableId = "";
    try {
      const statsListUrl = new URL(
        "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"
      );
      statsListUrl.searchParams.set("appId", appId);
      statsListUrl.searchParams.set("statsCode", "00200521");
      statsListUrl.searchParams.set("searchKind", "2");
      statsListUrl.searchParams.set("surveyYears", "2020");
      statsListUrl.searchParams.set("limit", "50");

      const listRes = await fetch(statsListUrl.toString());
      const listData = await listRes.json();

      // TABLE_INF can be a single object or an array
      const rawTables =
        listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;
      const tables: Record<string, unknown>[] = Array.isArray(rawTables)
        ? rawTables
        : rawTables
          ? [rawTables]
          : [];

      debugInfo.tablesFound = tables.length;
      debugInfo.tableTitles = tables.slice(0, 5).map((t) => getTitle(t));

      // Preference: 500m mesh > 1km mesh > any mesh with population
      const mesh4Table = tables.find((t) => {
        const title = getTitle(t);
        return (
          (title.includes("4次メッシュ") ||
            title.includes("500m") ||
            title.includes("2分の1")) &&
          (title.includes("人口") || title.includes("基本")) &&
          !title.includes("移動")
        );
      });

      const mesh3Table = tables.find((t) => {
        const title = getTitle(t);
        return (
          (title.includes("3次メッシュ") || title.includes("1km")) &&
          (title.includes("人口") || title.includes("基本"))
        );
      });

      const anyMeshPopTable = tables.find((t) => {
        const title = getTitle(t);
        return (
          title.includes("メッシュ") &&
          (title.includes("人口") || title.includes("基本"))
        );
      });

      if (mesh4Table) {
        targetTableId = String(mesh4Table["@id"] || "");
      } else if (mesh3Table) {
        targetTableId = String(mesh3Table["@id"] || "");
      } else if (anyMeshPopTable) {
        targetTableId = String(anyMeshPopTable["@id"] || "");
      }

      debugInfo.selectedTableId = targetTableId || "(none from dynamic)";
    } catch (e) {
      console.error("Failed to query stats list:", e);
      debugInfo.statsListError = String(e);
    }

    // Step 2: If dynamic lookup failed, try known statsDataIds for 2020 Census mesh
    const fallbackIds = [
      "0003448237", // 令和2年国勢調査 4次メッシュ(500m)
      "0003448233", // 令和2年国勢調査 3次メッシュ(1km)
      "0003448234", // 令和2年国勢調査 3次メッシュ 別パターン
      "0003448238", // 令和2年国勢調査 4次メッシュ 別パターン
    ];

    const idsToTry = targetTableId
      ? [targetTableId, ...fallbackIds]
      : fallbackIds;

    // Step 3: Fetch mesh data - try each ID until one works
    const primaryMeshes = [
      ...new Set(meshCodes3rd.map((c) => c.slice(0, 4))),
    ];

    debugInfo.primaryMeshCount = primaryMeshes.length;
    debugInfo.primaryMeshCodes = primaryMeshes;

    for (const statsId of idsToTry) {
      // Try first primary mesh to see if this ID works
      const testMesh = primaryMeshes[0];
      const testUrl = new URL(
        "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
      );
      testUrl.searchParams.set("appId", appId);
      testUrl.searchParams.set("statsDataId", statsId);
      testUrl.searchParams.set("cdMesh", testMesh);
      testUrl.searchParams.set("limit", "10000");

      try {
        const testRes = await fetch(testUrl.toString());
        const testData = await testRes.json();

        const testValues =
          testData?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
        const errInfo =
          testData?.GET_STATS_DATA?.RESULT;

        if (!Array.isArray(testValues) || testValues.length === 0) {
          debugInfo[`id_${statsId}`] = {
            status: "no_data",
            error: errInfo?.ERROR_MSG || "empty",
          };
          continue;
        }

        // This ID works! Fetch all primary meshes with it
        usedStatsId = statsId;
        debugInfo.workingStatsId = statsId;

        // Process the test result first
        processValues(testValues, cellMap, minLat, maxLat, minLng, maxLng);

        // Fetch remaining primary meshes in parallel (batches of 5)
        const remaining = primaryMeshes.slice(1);
        for (let i = 0; i < remaining.length; i += 5) {
          const batch = remaining.slice(i, i + 5);
          const results = await Promise.allSettled(
            batch.map(async (pm) => {
              const url = new URL(
                "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
              );
              url.searchParams.set("appId", appId);
              url.searchParams.set("statsDataId", statsId);
              url.searchParams.set("cdMesh", pm);
              url.searchParams.set("limit", "10000");
              const res = await fetch(url.toString());
              return res.json();
            })
          );

          for (const r of results) {
            if (r.status === "fulfilled") {
              const vals =
                r.value?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
              if (Array.isArray(vals)) {
                processValues(vals, cellMap, minLat, maxLat, minLng, maxLng);
              }
            }
          }
        }

        break; // Found working ID, done
      } catch (e) {
        debugInfo[`id_${statsId}`] = { status: "error", msg: String(e) };
      }
    }

    let cells = Array.from(cellMap.values());
    debugInfo.apiCellCount = cells.length;

    // If e-Stat returned no data, use estimation fallback
    if (cells.length === 0) {
      isEstimate = true;
      cells = estimatePopulationGrid(
        parsed.lat,
        parsed.lng,
        parsed.radiusKm
      );
    }

    const populations = cells.map((c) => c.population);
    const total = populations.reduce((a, b) => a + b, 0);
    const average = cells.length > 0 ? Math.round(total / cells.length) : 0;
    const max = cells.length > 0 ? Math.max(...populations) : 0;

    return NextResponse.json({
      cells: cells.slice(0, MAX_CELLS),
      summary: { total, average, max, cellCount: cells.length },
      isEstimate,
      debug: { usedStatsId, isFallback: isEstimate, ...debugInfo },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Extract title string from e-Stat TABLE_INF.
 * TITLE can be a plain string OR an object like {"$": "title", "@no": "1"}.
 */
function getTitle(table: Record<string, unknown>): string {
  const t = table?.TITLE;
  if (!t) return "";
  if (typeof t === "string") return t;
  if (typeof t === "object" && t !== null) {
    const obj = t as Record<string, unknown>;
    return String(obj["$"] || obj["#text"] || "");
  }
  return String(t);
}

/**
 * Process e-Stat VALUE array into cellMap, deduplicating by meshCode (keep max).
 */
function processValues(
  values: Record<string, string>[],
  cellMap: Map<string, PopulationCell>,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): void {
  const totalPopCat = findTotalPopulationCategory(values);

  for (const v of values) {
    const meshCode = v["@area"] || "";
    const catCode = v["@cat01"] || "";

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
      // Deduplicate: keep highest population for same mesh code
      const existing = cellMap.get(meshCode);
      if (!existing || population > existing.population) {
        cellMap.set(meshCode, {
          lat: coords.lat,
          lng: coords.lng,
          population,
          meshCode,
        });
      }
    }
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

  if (catCodes.size <= 1) return catCodes.size === 1 ? [...catCodes][0] : null;

  // Look for total population by name
  for (const [code, name] of catNames) {
    if (
      name.includes("人口総数") ||
      name.includes("総数") ||
      name === "人口" ||
      name.toLowerCase().includes("total")
    ) {
      return code;
    }
  }

  // Smallest code is typically the "total" row
  const sorted = [...catCodes].sort();
  return sorted[0] || null;
}

function generateMeshCodes(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): string[] {
  const codes: string[] = [];
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

    if (code.length <= 6) {
      lat += 1 / 24;
      lng += 1 / 16;
    } else if (code.length <= 8) {
      lat += 1 / 240;
      lng += 1 / 160;
    } else {
      if (code.length >= 9) {
        const subdivision = parseInt(code.slice(8, 9), 10);
        if (subdivision === 2) lng += 1 / 160;
        else if (subdivision === 3) lat += 1 / 240;
        else if (subdivision === 4) {
          lat += 1 / 240;
          lng += 1 / 160;
        }
      }
      lat += 1 / 480;
      lng += 1 / 320;
    }

    return { lat, lng };
  } catch {
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fallback estimation (used ONLY when e-Stat API fails)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function estimatePopulationGrid(
  centerLat: number,
  centerLng: number,
  radiusKm: number
): PopulationCell[] {
  const cells: PopulationCell[] = [];
  const latStep = 0.004167;
  const lngStep = 0.00625;
  const cellAreaKm2 = 0.25;

  const latDelta = radiusKm / 111.32;
  const lngDelta =
    radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));

  let seed = Math.abs(Math.floor(centerLat * 10000 + centerLng * 10000));

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
      const jitter = 0.9 + ((seed % 1000) / 1000) * 0.2; // 0.9-1.1

      cells.push({
        lat: Math.round(lat * 100000) / 100000,
        lng: Math.round(lng * 100000) / 100000,
        population: Math.max(0, Math.round(baseCellPop * jitter)),
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

  // ══ 福岡県 ══
  { lat: 33.590, lng: 130.402, coreDensity: 13000, radiusDeg: 0.15 },
  { lat: 33.620, lng: 130.450, coreDensity: 6000, radiusDeg: 0.06 },
  { lat: 33.580, lng: 130.330, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.560, lng: 130.410, coreDensity: 8000, radiusDeg: 0.05 },
  { lat: 33.884, lng: 130.875, coreDensity: 7500, radiusDeg: 0.10 },
  { lat: 33.870, lng: 130.760, coreDensity: 5000, radiusDeg: 0.08 },
  { lat: 33.942, lng: 130.959, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.319, lng: 130.509, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.646, lng: 130.691, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 33.030, lng: 130.446, coreDensity: 3500, radiusDeg: 0.04 },
  { lat: 33.533, lng: 130.471, coreDensity: 8000, radiusDeg: 0.03 },
  { lat: 33.537, lng: 130.487, coreDensity: 6500, radiusDeg: 0.03 },
  { lat: 33.496, lng: 130.515, coreDensity: 4000, radiusDeg: 0.04 },
  { lat: 33.513, lng: 130.524, coreDensity: 4500, radiusDeg: 0.03 },
  { lat: 33.806, lng: 130.540, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.729, lng: 130.471, coreDensity: 3500, radiusDeg: 0.03 },
  { lat: 33.770, lng: 130.490, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.557, lng: 130.197, coreDensity: 2500, radiusDeg: 0.03 },
  { lat: 33.500, lng: 130.423, coreDensity: 3500, radiusDeg: 0.02 },
  { lat: 33.612, lng: 130.482, coreDensity: 5000, radiusDeg: 0.02 },
  { lat: 33.595, lng: 130.482, coreDensity: 6500, radiusDeg: 0.02 },
  { lat: 33.744, lng: 130.730, coreDensity: 2500, radiusDeg: 0.03 },
  { lat: 33.637, lng: 130.805, coreDensity: 2200, radiusDeg: 0.03 },
  { lat: 33.727, lng: 131.000, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.815, lng: 130.711, coreDensity: 4000, radiusDeg: 0.02 },
  { lat: 33.396, lng: 130.556, coreDensity: 3500, radiusDeg: 0.03 },
  { lat: 33.163, lng: 130.407, coreDensity: 2000, radiusDeg: 0.03 },
  { lat: 33.421, lng: 130.666, coreDensity: 1500, radiusDeg: 0.03 },
  { lat: 33.567, lng: 130.723, coreDensity: 1200, radiusDeg: 0.03 },
  { lat: 33.720, lng: 130.665, coreDensity: 1000, radiusDeg: 0.02 },
  { lat: 33.154, lng: 130.474, coreDensity: 1200, radiusDeg: 0.02 },
  { lat: 33.210, lng: 130.502, coreDensity: 1800, radiusDeg: 0.02 },

  // ── その他九州 ──
  { lat: 33.249, lng: 130.299, coreDensity: 3000, radiusDeg: 0.05 },
  { lat: 32.750, lng: 129.878, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.159, lng: 129.723, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 32.803, lng: 130.708, coreDensity: 7000, radiusDeg: 0.10 },
  { lat: 33.238, lng: 131.613, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 31.911, lng: 131.424, coreDensity: 3500, radiusDeg: 0.06 },
  { lat: 31.597, lng: 130.557, coreDensity: 5000, radiusDeg: 0.08 },
  { lat: 33.959, lng: 130.942, coreDensity: 3000, radiusDeg: 0.04 },
];

function estimateCellDensity(lat: number, lng: number): number {
  let best = 0;

  for (const city of CITY_DENSITY_POINTS) {
    const dLat = (lat - city.lat) * 111.32;
    const dLng =
      (lng - city.lng) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    const rKm = city.radiusDeg * 111.32;

    if (dist < rKm) {
      const v = city.coreDensity * Math.pow(1 - dist / rKm, 1.5);
      if (v > best) best = v;
    } else if (dist < rKm * 2.0) {
      // Suburban fringe - small contribution, drops off quickly
      const v =
        city.coreDensity *
        0.08 *
        Math.pow(1 - (dist - rKm) / rKm, 2);
      if (v > best) best = v;
    }
  }

  if (best > 0) return Math.round(best);

  // No city influence = truly rural/mountainous
  // Keep very low - it's better to underestimate than overestimate
  // The real data from e-Stat should be used for accuracy
  return 5;
}
