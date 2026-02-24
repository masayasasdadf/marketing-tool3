import { NextRequest, NextResponse } from "next/server";
import { PopulationMeshRequestSchema } from "@/types";
import type { PopulationCell } from "@/types";
import { reverseGeocode } from "@/lib/gsi-geocode";
import { lookupByMuniCode } from "@/lib/sheets-reader";
import { resolveAreaName } from "@/lib/area-name-resolver";

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
    const lngDelta = parsed.radiusKm / (111.32 * Math.cos((parsed.lat * Math.PI) / 180));

    const minLat = parsed.lat - latDelta;
    const maxLat = parsed.lat + latDelta;
    const minLng = parsed.lng - lngDelta;
    const maxLng = parsed.lng + lngDelta;

    const cells: PopulationCell[] = [];
    let isEstimate = false;

    // ─── Step 1: 国土地理院APIで市区町村コード取得 ───
    const gsiResult = await reverseGeocode(parsed.lat, parsed.lng);
    let municipalityInfo: {
      code: string;
      name: string;
      population: number | null;
    } | null = null;

    if (gsiResult) {
      const name = await resolveAreaName(gsiResult.muniCd);
      // ─── Step 2: スプレッドシートから人口データ取得 ───
      const sheetPop = await lookupByMuniCode(gsiResult.muniCd, "0000A", 0);
      municipalityInfo = {
        code: gsiResult.muniCd,
        name,
        population: sheetPop,
      };
    }

    // ─── Step 3: メッシュ人口（e-Stat or 推定） ───
    const meshCodes = generateMeshCodes(minLat, maxLat, minLng, maxLng);

    if (meshCodes.length > 0) {
      // Try e-Stat mesh population API
      const primaryMeshes = [...new Set(meshCodes.map((c) => c.slice(0, 4)))];

      for (const primaryMesh of primaryMeshes) {
        const meshUrl = new URL("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData");
        meshUrl.searchParams.set("appId", appId);
        meshUrl.searchParams.set("statsDataId", "0003448237");
        meshUrl.searchParams.set("cdArea", primaryMesh);
        meshUrl.searchParams.set("sectionHeaderFlg", "2");
        meshUrl.searchParams.set("limit", "10000");

        try {
          const res = await fetch(meshUrl.toString());
          const data = await res.json();

          const values =
            data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

          if (Array.isArray(values)) {
            for (const v of values) {
              const meshCode = v["@area"] || v["@cat01"] || "";
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
        } catch {
          // Continue to next mesh
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

    // ─── Step 4: スプレッドシートの実人口で推定値を補正 ───
    // 推定値が市区町村の実人口を超えている場合、スケールダウンする
    // 推定値が実人口に比べて著しく低い場合、スケールアップする
    if (isEstimate && municipalityInfo?.population && municipalityInfo.population > 0) {
      const estimatedTotal = cells.reduce((sum, c) => sum + c.population, 0);
      if (estimatedTotal > 0) {
        const searchAreaKm2 = Math.PI * parsed.radiusKm * parsed.radiusKm;
        // 市区町村の人口密度から、この検索範囲に妥当な人口を推定
        // 日本の市区町村の平均面積 ≈ 人口規模に応じて異なる
        // 小さい村: 50-100km², 市: 100-500km², 大都市: 200-1000km²
        const realPop = municipalityInfo.population;
        const estimatedMuniAreaKm2 = estimateMunicipalityArea(realPop);
        const areaFraction = Math.min(1, searchAreaKm2 / estimatedMuniAreaKm2);
        const expectedPopInArea = Math.round(realPop * areaFraction);

        // 推定値が期待値から大きくずれている場合のみ補正
        if (estimatedTotal > expectedPopInArea * 1.5 || estimatedTotal < expectedPopInArea * 0.5) {
          const scale = expectedPopInArea / estimatedTotal;
          for (const cell of cells) {
            cell.population = Math.round(cell.population * scale);
          }
        }
      }
    }

    const populations = cells.map((c) => c.population);
    const total = populations.reduce((a, b) => a + b, 0);
    const average = cells.length > 0 ? Math.round(total / cells.length) : 0;
    const max = cells.length > 0 ? Math.max(...populations) : 0;

    return NextResponse.json({
      cells,
      summary: { total, average, max, cellCount: cells.length },
      isEstimate,
      // 新: 市区町村情報（GSI + スプレッドシートから取得）
      municipality: municipalityInfo,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
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

    lat += 1 / 240;
    lng += 1 / 160;

    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * 人口規模から市区町村の概算面積を推定する。
 * 日本の市区町村データに基づく大まかなヒューリスティック。
 */
function estimateMunicipalityArea(population: number): number {
  if (population < 3000) return 50;       // 小さな村: ~50 km²
  if (population < 10000) return 100;     // 村・小さな町: ~100 km²
  if (population < 30000) return 150;     // 町: ~150 km²
  if (population < 50000) return 200;     // 小さな市: ~200 km²
  if (population < 100000) return 250;    // 市: ~250 km²
  if (population < 200000) return 300;    // 中規模市: ~300 km²
  if (population < 500000) return 400;    // 大きな市: ~400 km²
  return 600;                              // 政令指定都市: ~600 km²
}

/**
 * Estimate population grid when e-Stat mesh data is unavailable.
 * 500m mesh cell = ~0.25 km2
 */
function estimatePopulationGrid(
  centerLat: number,
  centerLng: number,
  radiusKm: number
): PopulationCell[] {
  const cells: PopulationCell[] = [];

  const latStep = 0.004167; // ~500m
  const lngStep = 0.00625;  // ~500m
  const cellAreaKm2 = 0.25;

  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));

  let seed = Math.abs(Math.floor(centerLat * 10000 + centerLng * 10000));

  for (let lat = centerLat - latDelta; lat <= centerLat + latDelta; lat += latStep) {
    for (let lng = centerLng - lngDelta; lng <= centerLng + lngDelta; lng += lngStep) {
      const dist = Math.sqrt(
        Math.pow((lat - centerLat) * 111.32, 2) +
          Math.pow((lng - centerLng) * 111.32 * Math.cos((centerLat * Math.PI) / 180), 2)
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
      const jitter = 0.85 + ((seed % 1000) / 1000) * 0.3;

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
  // 東京都
  { lat: 35.6812, lng: 139.7671, coreDensity: 15000, radiusDeg: 0.25 },
  { lat: 35.7100, lng: 139.8200, coreDensity: 13000, radiusDeg: 0.12 },
  { lat: 35.6100, lng: 139.7200, coreDensity: 12000, radiusDeg: 0.10 },
  { lat: 35.7500, lng: 139.6800, coreDensity: 11000, radiusDeg: 0.10 },
  { lat: 35.6700, lng: 139.6300, coreDensity: 11000, radiusDeg: 0.10 },
  { lat: 35.6983, lng: 139.4144, coreDensity: 4000, radiusDeg: 0.08 },
  { lat: 35.5488, lng: 139.4467, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 35.6300, lng: 139.4500, coreDensity: 6000, radiusDeg: 0.05 },
  // 神奈川県
  { lat: 35.4437, lng: 139.6380, coreDensity: 12000, radiusDeg: 0.12 },
  { lat: 35.3900, lng: 139.5800, coreDensity: 6000, radiusDeg: 0.08 },
  { lat: 35.5100, lng: 139.5700, coreDensity: 7000, radiusDeg: 0.08 },
  { lat: 35.5309, lng: 139.7030, coreDensity: 11000, radiusDeg: 0.08 },
  { lat: 35.5713, lng: 139.3734, coreDensity: 5500, radiusDeg: 0.06 },
  { lat: 35.3390, lng: 139.4900, coreDensity: 6000, radiusDeg: 0.04 },
  { lat: 35.2814, lng: 139.6722, coreDensity: 4000, radiusDeg: 0.04 },
  { lat: 35.3300, lng: 139.3500, coreDensity: 5000, radiusDeg: 0.04 },
  { lat: 35.4420, lng: 139.3620, coreDensity: 3500, radiusDeg: 0.03 },
  // 埼玉県
  { lat: 35.8617, lng: 139.6455, coreDensity: 9000, radiusDeg: 0.10 },
  { lat: 35.8078, lng: 139.7241, coreDensity: 10000, radiusDeg: 0.05 },
  { lat: 35.9251, lng: 139.4858, coreDensity: 4000, radiusDeg: 0.05 },
  { lat: 35.7990, lng: 139.4689, coreDensity: 5500, radiusDeg: 0.05 },
  { lat: 35.8910, lng: 139.7900, coreDensity: 7000, radiusDeg: 0.06 },
  { lat: 35.9752, lng: 139.7525, coreDensity: 4000, radiusDeg: 0.04 },
  // 千葉県
  { lat: 35.6073, lng: 140.1063, coreDensity: 6500, radiusDeg: 0.08 },
  { lat: 35.6947, lng: 139.9828, coreDensity: 9000, radiusDeg: 0.06 },
  { lat: 35.7867, lng: 139.9029, coreDensity: 7000, radiusDeg: 0.06 },
  { lat: 35.6539, lng: 139.9019, coreDensity: 9000, radiusDeg: 0.03 },
  // 大阪府
  { lat: 34.6937, lng: 135.5023, coreDensity: 14000, radiusDeg: 0.15 },
  { lat: 34.7700, lng: 135.4700, coreDensity: 8000, radiusDeg: 0.08 },
  { lat: 34.5733, lng: 135.4831, coreDensity: 7000, radiusDeg: 0.08 },
  { lat: 34.6797, lng: 135.6014, coreDensity: 9000, radiusDeg: 0.05 },
  { lat: 34.8143, lng: 135.6500, coreDensity: 5500, radiusDeg: 0.05 },
  { lat: 34.8468, lng: 135.6173, coreDensity: 5000, radiusDeg: 0.04 },
  { lat: 34.4600, lng: 135.3700, coreDensity: 4000, radiusDeg: 0.04 },
  // 愛知県
  { lat: 35.1815, lng: 136.9066, coreDensity: 11000, radiusDeg: 0.15 },
  { lat: 35.1600, lng: 136.9700, coreDensity: 6000, radiusDeg: 0.06 },
  { lat: 35.0834, lng: 137.1565, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 34.7693, lng: 137.3916, coreDensity: 3500, radiusDeg: 0.05 },
  { lat: 34.9511, lng: 137.1625, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 35.3045, lng: 136.8030, coreDensity: 5000, radiusDeg: 0.04 },
  { lat: 35.2475, lng: 136.9725, coreDensity: 5000, radiusDeg: 0.04 },
  // 北海道
  { lat: 43.0621, lng: 141.3544, coreDensity: 10000, radiusDeg: 0.12 },
  { lat: 43.0200, lng: 141.3800, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 43.7709, lng: 142.3650, coreDensity: 3000, radiusDeg: 0.05 },
  { lat: 41.7688, lng: 140.7290, coreDensity: 3000, radiusDeg: 0.04 },
  // 兵庫県
  { lat: 34.6901, lng: 135.1956, coreDensity: 9000, radiusDeg: 0.10 },
  { lat: 34.8155, lng: 134.6854, coreDensity: 4000, radiusDeg: 0.06 },
  { lat: 34.7350, lng: 135.3400, coreDensity: 10000, radiusDeg: 0.06 },
  { lat: 34.6430, lng: 134.9970, coreDensity: 5500, radiusDeg: 0.04 },
  // 京都府
  { lat: 35.0116, lng: 135.7681, coreDensity: 8000, radiusDeg: 0.10 },
  { lat: 34.9300, lng: 135.7800, coreDensity: 4500, radiusDeg: 0.05 },
  // 宮城県
  { lat: 38.2682, lng: 140.8694, coreDensity: 8500, radiusDeg: 0.10 },
  // 広島県
  { lat: 34.3853, lng: 132.4553, coreDensity: 8500, radiusDeg: 0.10 },
  { lat: 34.4860, lng: 133.3625, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 34.2492, lng: 132.5656, coreDensity: 2500, radiusDeg: 0.03 },
  // 福岡県
  { lat: 33.5902, lng: 130.4017, coreDensity: 13000, radiusDeg: 0.15 },
  { lat: 33.6200, lng: 130.4500, coreDensity: 6000, radiusDeg: 0.06 },
  { lat: 33.5800, lng: 130.3300, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.5600, lng: 130.4100, coreDensity: 8000, radiusDeg: 0.05 },
  { lat: 33.8835, lng: 130.8752, coreDensity: 7500, radiusDeg: 0.10 },
  { lat: 33.8700, lng: 130.7600, coreDensity: 5000, radiusDeg: 0.08 },
  { lat: 33.9420, lng: 130.9590, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.3190, lng: 130.5088, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.6461, lng: 130.6914, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 33.0303, lng: 130.4461, coreDensity: 3500, radiusDeg: 0.04 },
  { lat: 33.5328, lng: 130.4714, coreDensity: 8000, radiusDeg: 0.03 },
  { lat: 33.5367, lng: 130.4867, coreDensity: 6500, radiusDeg: 0.03 },
  { lat: 33.4958, lng: 130.5153, coreDensity: 4000, radiusDeg: 0.04 },
  { lat: 33.5125, lng: 130.5239, coreDensity: 4500, radiusDeg: 0.03 },
  { lat: 33.8061, lng: 130.5400, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.7289, lng: 130.4706, coreDensity: 3500, radiusDeg: 0.03 },
  { lat: 33.7700, lng: 130.4900, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.5569, lng: 130.1969, coreDensity: 2500, radiusDeg: 0.03 },
  { lat: 33.4997, lng: 130.4225, coreDensity: 3500, radiusDeg: 0.02 },
  { lat: 33.6117, lng: 130.4817, coreDensity: 5000, radiusDeg: 0.02 },
  { lat: 33.5950, lng: 130.4817, coreDensity: 6500, radiusDeg: 0.02 },
  { lat: 33.7147, lng: 130.4519, coreDensity: 4000, radiusDeg: 0.02 },
  { lat: 33.7439, lng: 130.7300, coreDensity: 2500, radiusDeg: 0.03 },
  { lat: 33.6367, lng: 130.8050, coreDensity: 2200, radiusDeg: 0.03 },
  { lat: 33.7272, lng: 131.0003, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 33.1625, lng: 130.4069, coreDensity: 2000, radiusDeg: 0.03 },
  { lat: 33.2108, lng: 130.5578, coreDensity: 1500, radiusDeg: 0.03 },
  { lat: 33.3964, lng: 130.5556, coreDensity: 3500, radiusDeg: 0.03 },
  { lat: 33.8153, lng: 130.7114, coreDensity: 4000, radiusDeg: 0.02 },
  { lat: 33.4208, lng: 130.6658, coreDensity: 1500, radiusDeg: 0.03 },
  { lat: 33.5667, lng: 130.7233, coreDensity: 1200, radiusDeg: 0.03 },
  { lat: 33.7200, lng: 130.6650, coreDensity: 1000, radiusDeg: 0.02 },
  { lat: 33.6114, lng: 131.1297, coreDensity: 1200, radiusDeg: 0.02 },
  { lat: 33.3469, lng: 130.7536, coreDensity: 1000, radiusDeg: 0.02 },
  { lat: 33.1536, lng: 130.4744, coreDensity: 1200, radiusDeg: 0.02 },
  // その他九州
  { lat: 33.2494, lng: 130.2988, coreDensity: 3000, radiusDeg: 0.05 },
  { lat: 32.7503, lng: 129.8779, coreDensity: 5000, radiusDeg: 0.06 },
  { lat: 33.1593, lng: 129.7228, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 32.8032, lng: 130.7079, coreDensity: 7000, radiusDeg: 0.10 },
  { lat: 33.2382, lng: 131.6126, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 31.9111, lng: 131.4239, coreDensity: 3500, radiusDeg: 0.06 },
  { lat: 31.5966, lng: 130.5571, coreDensity: 5000, radiusDeg: 0.08 },
  { lat: 33.2846, lng: 131.5007, coreDensity: 3000, radiusDeg: 0.03 },
  { lat: 31.7230, lng: 131.0622, coreDensity: 2000, radiusDeg: 0.04 },
  // 中国地方
  { lat: 34.6551, lng: 133.9195, coreDensity: 5500, radiusDeg: 0.08 },
  { lat: 34.5850, lng: 133.7720, coreDensity: 3500, radiusDeg: 0.05 },
  { lat: 35.4723, lng: 133.0505, coreDensity: 2500, radiusDeg: 0.04 },
  { lat: 34.1861, lng: 131.4707, coreDensity: 2000, radiusDeg: 0.03 },
  { lat: 33.9588, lng: 130.9416, coreDensity: 3000, radiusDeg: 0.04 },
  // 四国
  { lat: 33.8392, lng: 132.7657, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 34.3401, lng: 134.0434, coreDensity: 4000, radiusDeg: 0.05 },
  { lat: 33.5597, lng: 133.5311, coreDensity: 3500, radiusDeg: 0.04 },
  { lat: 34.0657, lng: 134.5593, coreDensity: 3500, radiusDeg: 0.04 },
  // 北信越
  { lat: 37.9161, lng: 139.0364, coreDensity: 4500, radiusDeg: 0.08 },
  { lat: 36.5613, lng: 136.6562, coreDensity: 4000, radiusDeg: 0.06 },
  { lat: 36.6953, lng: 137.2113, coreDensity: 3500, radiusDeg: 0.05 },
  { lat: 36.6514, lng: 138.1811, coreDensity: 3000, radiusDeg: 0.04 },
  // 東北
  { lat: 39.7036, lng: 141.1527, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 39.7200, lng: 140.1025, coreDensity: 2500, radiusDeg: 0.04 },
  { lat: 38.2405, lng: 140.3633, coreDensity: 2500, radiusDeg: 0.04 },
  { lat: 37.7500, lng: 140.4678, coreDensity: 2500, radiusDeg: 0.04 },
  { lat: 37.3999, lng: 140.3596, coreDensity: 3000, radiusDeg: 0.05 },
  { lat: 37.0504, lng: 140.8878, coreDensity: 2000, radiusDeg: 0.04 },
  { lat: 40.8246, lng: 140.7400, coreDensity: 2500, radiusDeg: 0.04 },
  // 静岡県
  { lat: 34.9756, lng: 138.3828, coreDensity: 4500, radiusDeg: 0.06 },
  { lat: 34.7108, lng: 137.7261, coreDensity: 4000, radiusDeg: 0.06 },
  // 茨城・栃木・群馬
  { lat: 36.3419, lng: 140.4468, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 36.0835, lng: 140.0766, coreDensity: 3500, radiusDeg: 0.04 },
  { lat: 36.5551, lng: 139.8825, coreDensity: 3500, radiusDeg: 0.06 },
  { lat: 36.3911, lng: 139.0608, coreDensity: 3000, radiusDeg: 0.04 },
  { lat: 36.3221, lng: 139.0030, coreDensity: 3000, radiusDeg: 0.04 },
  // 沖縄
  { lat: 26.3344, lng: 127.8015, coreDensity: 8500, radiusDeg: 0.04 },
  { lat: 26.3342, lng: 127.8056, coreDensity: 5000, radiusDeg: 0.03 },
  { lat: 26.3460, lng: 127.7221, coreDensity: 7000, radiusDeg: 0.02 },
];

interface RegionalDensity {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  density: number;
}

const REGIONAL_RURAL_DENSITIES: RegionalDensity[] = [
  { minLat: 41.0, maxLat: 46.0, minLng: 139.0, maxLng: 146.0, density: 15 },
  { minLat: 37.0, maxLat: 41.0, minLng: 138.0, maxLng: 142.0, density: 60 },
  { minLat: 35.0, maxLat: 37.0, minLng: 138.5, maxLng: 141.0, density: 200 },
  { minLat: 35.5, maxLat: 37.5, minLng: 136.0, maxLng: 139.0, density: 50 },
  { minLat: 34.5, maxLat: 35.5, minLng: 136.0, maxLng: 139.0, density: 150 },
  { minLat: 34.0, maxLat: 35.5, minLng: 134.0, maxLng: 136.5, density: 150 },
  { minLat: 33.5, maxLat: 35.5, minLng: 130.5, maxLng: 134.0, density: 80 },
  { minLat: 32.5, maxLat: 34.5, minLng: 132.0, maxLng: 134.5, density: 80 },
  { minLat: 33.3, maxLat: 34.0, minLng: 130.0, maxLng: 131.5, density: 150 },
  { minLat: 31.0, maxLat: 33.5, minLng: 129.5, maxLng: 132.0, density: 80 },
  { minLat: 24.0, maxLat: 27.0, minLng: 122.0, maxLng: 129.0, density: 100 },
];

function estimateCellDensity(lat: number, lng: number): number {
  let maxContribution = 0;

  for (const city of CITY_DENSITY_POINTS) {
    const dLat = (lat - city.lat) * 111.32;
    const dLng = (lng - city.lng) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const d = Math.sqrt(dLat * dLat + dLng * dLng);
    const radiusKm = city.radiusDeg * 111.32;

    if (d < radiusKm) {
      const ratio = d / radiusKm;
      const contribution = city.coreDensity * Math.pow(1 - ratio, 1.5);
      maxContribution = Math.max(maxContribution, contribution);
    } else if (d < radiusKm * 2.5) {
      const ratio = (d - radiusKm) / (radiusKm * 1.5);
      const contribution = city.coreDensity * 0.15 * Math.pow(1 - ratio, 2);
      maxContribution = Math.max(maxContribution, contribution);
    }
  }

  if (maxContribution > 0) {
    return Math.round(maxContribution);
  }

  return getRegionalRuralDensity(lat, lng);
}

function getRegionalRuralDensity(lat: number, lng: number): number {
  for (const region of REGIONAL_RURAL_DENSITIES) {
    if (
      lat >= region.minLat &&
      lat <= region.maxLat &&
      lng >= region.minLng &&
      lng <= region.maxLng
    ) {
      return region.density;
    }
  }
  return 30;
}
