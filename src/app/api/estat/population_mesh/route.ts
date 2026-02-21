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
    const lngDelta = parsed.radiusKm / (111.32 * Math.cos((parsed.lat * Math.PI) / 180));

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

    // Try e-Stat mesh population API
    // Use 1st-level mesh codes (4 digits) to query regional data
    const primaryMeshes = [...new Set(meshCodes.map((c) => c.slice(0, 4)))];

    // Query all primary meshes needed (no artificial limit)
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
 * Estimate population grid when e-Stat mesh data is unavailable.
 *
 * CRITICAL: Density is evaluated PER CELL, not just at the center.
 * This ensures that a search circle over mountains gets low density
 * even if it partially overlaps with a city.
 *
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

      // Evaluate density AT THIS CELL's coordinates, not at center
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

// ─── Known city/town centers with population density data ───
// Based on 令和2年国勢調査 (2020 Census) actual population density.
// coreDensity = people/km² at urban core (DID地区 densely inhabited district)
// radiusDeg = approximate urban extent in degrees (~1 deg ≈ 111km)
interface CityDensityPoint {
  lat: number;
  lng: number;
  coreDensity: number;
  radiusDeg: number;
}

const CITY_DENSITY_POINTS: CityDensityPoint[] = [
  // ════════════════════════════════════════════════
  // 東京都 (Tokyo)
  // ════════════════════════════════════════════════
  // 東京都心 (千代田・中央・港・新宿・渋谷・豊島)
  { lat: 35.6812, lng: 139.7671, coreDensity: 15000, radiusDeg: 0.25 },
  // 東京東部 (台東・墨田・江東・荒川・葛飾・江戸川)
  { lat: 35.7100, lng: 139.8200, coreDensity: 13000, radiusDeg: 0.12 },
  // 東京南部 (品川・目黒・大田)
  { lat: 35.6100, lng: 139.7200, coreDensity: 12000, radiusDeg: 0.10 },
  // 東京北西 (練馬・板橋・北)
  { lat: 35.7500, lng: 139.6800, coreDensity: 11000, radiusDeg: 0.10 },
  // 東京西部 (中野・杉並・世田谷)
  { lat: 35.6700, lng: 139.6300, coreDensity: 11000, radiusDeg: 0.10 },
  // 立川・八王子
  { lat: 35.6983, lng: 139.4144, coreDensity: 4000, radiusDeg: 0.08 },
  // 町田
  { lat: 35.5488, lng: 139.4467, coreDensity: 5000, radiusDeg: 0.06 },
  // 多摩ニュータウン
  { lat: 35.6300, lng: 139.4500, coreDensity: 6000, radiusDeg: 0.05 },

  // ════════════════════════════════════════════════
  // 神奈川県 (Kanagawa)
  // ════════════════════════════════════════════════
  // 横浜中心 (西区・中区・神奈川区)
  { lat: 35.4437, lng: 139.6380, coreDensity: 12000, radiusDeg: 0.12 },
  // 横浜南部 (戸塚・港南・栄)
  { lat: 35.3900, lng: 139.5800, coreDensity: 6000, radiusDeg: 0.08 },
  // 横浜北部 (青葉・都筑・港北)
  { lat: 35.5100, lng: 139.5700, coreDensity: 7000, radiusDeg: 0.08 },
  // 川崎
  { lat: 35.5309, lng: 139.7030, coreDensity: 11000, radiusDeg: 0.08 },
  // 相模原
  { lat: 35.5713, lng: 139.3734, coreDensity: 5500, radiusDeg: 0.06 },
  // 藤沢
  { lat: 35.3390, lng: 139.4900, coreDensity: 6000, radiusDeg: 0.04 },
  // 横須賀
  { lat: 35.2814, lng: 139.6722, coreDensity: 4000, radiusDeg: 0.04 },
  // 平塚・茅ヶ崎
  { lat: 35.3300, lng: 139.3500, coreDensity: 5000, radiusDeg: 0.04 },
  // 厚木
  { lat: 35.4420, lng: 139.3620, coreDensity: 3500, radiusDeg: 0.03 },

  // ════════════════════════════════════════════════
  // 埼玉県 (Saitama)
  // ════════════════════════════════════════════════
  // さいたま市 (大宮・浦和)
  { lat: 35.8617, lng: 139.6455, coreDensity: 9000, radiusDeg: 0.10 },
  // 川口
  { lat: 35.8078, lng: 139.7241, coreDensity: 10000, radiusDeg: 0.05 },
  // 川越
  { lat: 35.9251, lng: 139.4858, coreDensity: 4000, radiusDeg: 0.05 },
  // 所沢
  { lat: 35.7990, lng: 139.4689, coreDensity: 5500, radiusDeg: 0.05 },
  // 越谷・草加
  { lat: 35.8910, lng: 139.7900, coreDensity: 7000, radiusDeg: 0.06 },
  // 春日部
  { lat: 35.9752, lng: 139.7525, coreDensity: 4000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 千葉県 (Chiba)
  // ════════════════════════════════════════════════
  // 千葉市中心
  { lat: 35.6073, lng: 140.1063, coreDensity: 6500, radiusDeg: 0.08 },
  // 船橋・市川
  { lat: 35.6947, lng: 139.9828, coreDensity: 9000, radiusDeg: 0.06 },
  // 松戸・柏
  { lat: 35.7867, lng: 139.9029, coreDensity: 7000, radiusDeg: 0.06 },
  // 浦安
  { lat: 35.6539, lng: 139.9019, coreDensity: 9000, radiusDeg: 0.03 },

  // ════════════════════════════════════════════════
  // 大阪府 (Osaka)
  // ════════════════════════════════════════════════
  // 大阪市中心
  { lat: 34.6937, lng: 135.5023, coreDensity: 14000, radiusDeg: 0.15 },
  // 大阪北部 (豊中・吹田・箕面)
  { lat: 34.7700, lng: 135.4700, coreDensity: 8000, radiusDeg: 0.08 },
  // 大阪南部 (堺市)
  { lat: 34.5733, lng: 135.4831, coreDensity: 7000, radiusDeg: 0.08 },
  // 東大阪
  { lat: 34.6797, lng: 135.6014, coreDensity: 9000, radiusDeg: 0.05 },
  // 枚方・寝屋川
  { lat: 34.8143, lng: 135.6500, coreDensity: 5500, radiusDeg: 0.05 },
  // 高槻
  { lat: 34.8468, lng: 135.6173, coreDensity: 5000, radiusDeg: 0.04 },
  // 岸和田・泉佐野
  { lat: 34.4600, lng: 135.3700, coreDensity: 4000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 愛知県 (Aichi)
  // ════════════════════════════════════════════════
  // 名古屋市中心
  { lat: 35.1815, lng: 136.9066, coreDensity: 11000, radiusDeg: 0.15 },
  // 名古屋東部 (名東・千種・天白)
  { lat: 35.1600, lng: 136.9700, coreDensity: 6000, radiusDeg: 0.06 },
  // 豊田
  { lat: 35.0834, lng: 137.1565, coreDensity: 3000, radiusDeg: 0.04 },
  // 豊橋
  { lat: 34.7693, lng: 137.3916, coreDensity: 3500, radiusDeg: 0.05 },
  // 岡崎
  { lat: 34.9511, lng: 137.1625, coreDensity: 3000, radiusDeg: 0.04 },
  // 一宮
  { lat: 35.3045, lng: 136.8030, coreDensity: 5000, radiusDeg: 0.04 },
  // 春日井
  { lat: 35.2475, lng: 136.9725, coreDensity: 5000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 北海道 (Hokkaido)
  // ════════════════════════════════════════════════
  // 札幌市中心 (中央区・北区)
  { lat: 43.0621, lng: 141.3544, coreDensity: 10000, radiusDeg: 0.12 },
  // 札幌南部 (豊平・清田)
  { lat: 43.0200, lng: 141.3800, coreDensity: 5000, radiusDeg: 0.06 },
  // 旭川
  { lat: 43.7709, lng: 142.3650, coreDensity: 3000, radiusDeg: 0.05 },
  // 函館
  { lat: 41.7688, lng: 140.7290, coreDensity: 3000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 兵庫県 (Hyogo)
  // ════════════════════════════════════════════════
  // 神戸市中心
  { lat: 34.6901, lng: 135.1956, coreDensity: 9000, radiusDeg: 0.10 },
  // 姫路
  { lat: 34.8155, lng: 134.6854, coreDensity: 4000, radiusDeg: 0.06 },
  // 西宮・尼崎
  { lat: 34.7350, lng: 135.3400, coreDensity: 10000, radiusDeg: 0.06 },
  // 明石
  { lat: 34.6430, lng: 134.9970, coreDensity: 5500, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 京都府 (Kyoto)
  // ════════════════════════════════════════════════
  // 京都市中心
  { lat: 35.0116, lng: 135.7681, coreDensity: 8000, radiusDeg: 0.10 },
  // 京都南部 (伏見・宇治)
  { lat: 34.9300, lng: 135.7800, coreDensity: 4500, radiusDeg: 0.05 },

  // ════════════════════════════════════════════════
  // 宮城県 (Miyagi)
  // ════════════════════════════════════════════════
  // 仙台市中心
  { lat: 38.2682, lng: 140.8694, coreDensity: 8500, radiusDeg: 0.10 },

  // ════════════════════════════════════════════════
  // 広島県 (Hiroshima)
  // ════════════════════════════════════════════════
  // 広島市中心
  { lat: 34.3853, lng: 132.4553, coreDensity: 8500, radiusDeg: 0.10 },
  // 福山
  { lat: 34.4860, lng: 133.3625, coreDensity: 3000, radiusDeg: 0.04 },
  // 呉
  { lat: 34.2492, lng: 132.5656, coreDensity: 2500, radiusDeg: 0.03 },

  // ════════════════════════════════════════════════
  // 福岡県 (Fukuoka) - 全主要都市を網羅
  // ════════════════════════════════════════════════
  // 福岡市中心 (博多・天神・中央区) - DID人口密度 約13,000/km²
  { lat: 33.5902, lng: 130.4017, coreDensity: 13000, radiusDeg: 0.15 },
  // 福岡市東部 (東区・粕屋方面)
  { lat: 33.6200, lng: 130.4500, coreDensity: 6000, radiusDeg: 0.06 },
  // 福岡市西部 (西区・早良区)
  { lat: 33.5800, lng: 130.3300, coreDensity: 5000, radiusDeg: 0.06 },
  // 福岡市南部 (南区・城南区)
  { lat: 33.5600, lng: 130.4100, coreDensity: 8000, radiusDeg: 0.05 },

  // 北九州市中心 (小倉北区・小倉南区)
  { lat: 33.8835, lng: 130.8752, coreDensity: 7500, radiusDeg: 0.10 },
  // 北九州市西部 (八幡東・八幡西・戸畑・若松)
  { lat: 33.8700, lng: 130.7600, coreDensity: 5000, radiusDeg: 0.08 },
  // 北九州市門司
  { lat: 33.9420, lng: 130.9590, coreDensity: 3000, radiusDeg: 0.03 },

  // 久留米市 (人口約30万)
  { lat: 33.3190, lng: 130.5088, coreDensity: 5000, radiusDeg: 0.06 },
  // 飯塚市 (人口約12.5万)
  { lat: 33.6461, lng: 130.6914, coreDensity: 3000, radiusDeg: 0.04 },
  // 大牟田市 (人口約11万)
  { lat: 33.0303, lng: 130.4461, coreDensity: 3500, radiusDeg: 0.04 },
  // 春日市 (人口約11.3万, 面積14km² → 密度約8,000)
  { lat: 33.5328, lng: 130.4714, coreDensity: 8000, radiusDeg: 0.03 },
  // 大野城市 (人口約10.2万, 面積27km²)
  { lat: 33.5367, lng: 130.4867, coreDensity: 6500, radiusDeg: 0.03 },
  // 筑紫野市 (人口約10.5万)
  { lat: 33.4958, lng: 130.5153, coreDensity: 4000, radiusDeg: 0.04 },
  // 太宰府市 (人口約7.2万)
  { lat: 33.5125, lng: 130.5239, coreDensity: 4500, radiusDeg: 0.03 },
  // 宗像市 (人口約9.7万)
  { lat: 33.8061, lng: 130.5400, coreDensity: 3000, radiusDeg: 0.03 },
  // 古賀市 (人口約5.9万)
  { lat: 33.7289, lng: 130.4706, coreDensity: 3500, radiusDeg: 0.03 },
  // 福津市 (人口約6.7万)
  { lat: 33.7700, lng: 130.4900, coreDensity: 3000, radiusDeg: 0.03 },
  // 糸島市 (人口約10万)
  { lat: 33.5569, lng: 130.1969, coreDensity: 2500, radiusDeg: 0.03 },
  // 那珂川市 (人口約5万)
  { lat: 33.4997, lng: 130.4225, coreDensity: 3500, radiusDeg: 0.02 },
  // 粕屋町 (人口約4.8万)
  { lat: 33.6117, lng: 130.4817, coreDensity: 5000, radiusDeg: 0.02 },
  // 志免町 (人口約4.6万)
  { lat: 33.5950, lng: 130.4817, coreDensity: 6500, radiusDeg: 0.02 },
  // 新宮町 (人口約3.3万)
  { lat: 33.7147, lng: 130.4519, coreDensity: 4000, radiusDeg: 0.02 },

  // 直方市 (人口約5.5万, 面積62km²)
  { lat: 33.7439, lng: 130.7300, coreDensity: 2500, radiusDeg: 0.03 },
  // 田川市 (人口約4.5万, 面積55km²)
  { lat: 33.6367, lng: 130.8050, coreDensity: 2200, radiusDeg: 0.03 },
  // 行橋市 (人口約7.2万)
  { lat: 33.7272, lng: 131.0003, coreDensity: 3000, radiusDeg: 0.03 },
  // 柳川市 (人口約6.3万)
  { lat: 33.1625, lng: 130.4069, coreDensity: 2000, radiusDeg: 0.03 },
  // 八女市 (人口約6万)
  { lat: 33.2108, lng: 130.5578, coreDensity: 1500, radiusDeg: 0.03 },
  // 小郡市 (人口約5.9万)
  { lat: 33.3964, lng: 130.5556, coreDensity: 3500, radiusDeg: 0.03 },
  // 中間市 (人口約3.8万, 面積16km² → 密度約2,400)
  { lat: 33.8153, lng: 130.7114, coreDensity: 4000, radiusDeg: 0.02 },
  // 朝倉市 (人口約4.9万)
  { lat: 33.4208, lng: 130.6658, coreDensity: 1500, radiusDeg: 0.03 },
  // 嘉麻市 (人口約3.5万)
  { lat: 33.5667, lng: 130.7233, coreDensity: 1200, radiusDeg: 0.03 },
  // 宮若市 (人口約2.6万)
  { lat: 33.7200, lng: 130.6650, coreDensity: 1000, radiusDeg: 0.02 },
  // 豊前市 (人口約2.4万)
  { lat: 33.6114, lng: 131.1297, coreDensity: 1200, radiusDeg: 0.02 },
  // うきは市 (人口約2.7万)
  { lat: 33.3469, lng: 130.7536, coreDensity: 1000, radiusDeg: 0.02 },
  // みやま市 (人口約3.5万)
  { lat: 33.1536, lng: 130.4744, coreDensity: 1200, radiusDeg: 0.02 },

  // ════════════════════════════════════════════════
  // その他九州 (Other Kyushu)
  // ════════════════════════════════════════════════
  // 佐賀市
  { lat: 33.2494, lng: 130.2988, coreDensity: 3000, radiusDeg: 0.05 },
  // 長崎市
  { lat: 32.7503, lng: 129.8779, coreDensity: 5000, radiusDeg: 0.06 },
  // 佐世保市
  { lat: 33.1593, lng: 129.7228, coreDensity: 3000, radiusDeg: 0.04 },
  // 熊本市中心
  { lat: 32.8032, lng: 130.7079, coreDensity: 7000, radiusDeg: 0.10 },
  // 大分市
  { lat: 33.2382, lng: 131.6126, coreDensity: 4500, radiusDeg: 0.06 },
  // 宮崎市
  { lat: 31.9111, lng: 131.4239, coreDensity: 3500, radiusDeg: 0.06 },
  // 鹿児島市
  { lat: 31.5966, lng: 130.5571, coreDensity: 5000, radiusDeg: 0.08 },
  // 別府市
  { lat: 33.2846, lng: 131.5007, coreDensity: 3000, radiusDeg: 0.03 },
  // 都城市
  { lat: 31.7230, lng: 131.0622, coreDensity: 2000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 中国地方 (Chugoku)
  // ════════════════════════════════════════════════
  // 岡山市
  { lat: 34.6551, lng: 133.9195, coreDensity: 5500, radiusDeg: 0.08 },
  // 倉敷市
  { lat: 34.5850, lng: 133.7720, coreDensity: 3500, radiusDeg: 0.05 },
  // 松江市
  { lat: 35.4723, lng: 133.0505, coreDensity: 2500, radiusDeg: 0.04 },
  // 山口市
  { lat: 34.1861, lng: 131.4707, coreDensity: 2000, radiusDeg: 0.03 },
  // 下関市
  { lat: 33.9588, lng: 130.9416, coreDensity: 3000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 四国 (Shikoku)
  // ════════════════════════════════════════════════
  // 松山市
  { lat: 33.8392, lng: 132.7657, coreDensity: 4500, radiusDeg: 0.06 },
  // 高松市
  { lat: 34.3401, lng: 134.0434, coreDensity: 4000, radiusDeg: 0.05 },
  // 高知市
  { lat: 33.5597, lng: 133.5311, coreDensity: 3500, radiusDeg: 0.04 },
  // 徳島市
  { lat: 34.0657, lng: 134.5593, coreDensity: 3500, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 北信越 (Hokushinetsu)
  // ════════════════════════════════════════════════
  // 新潟市
  { lat: 37.9161, lng: 139.0364, coreDensity: 4500, radiusDeg: 0.08 },
  // 金沢市
  { lat: 36.5613, lng: 136.6562, coreDensity: 4000, radiusDeg: 0.06 },
  // 富山市
  { lat: 36.6953, lng: 137.2113, coreDensity: 3500, radiusDeg: 0.05 },
  // 長野市
  { lat: 36.6514, lng: 138.1811, coreDensity: 3000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 東北 (Tohoku)
  // ════════════════════════════════════════════════
  // 盛岡市
  { lat: 39.7036, lng: 141.1527, coreDensity: 3000, radiusDeg: 0.04 },
  // 秋田市
  { lat: 39.7200, lng: 140.1025, coreDensity: 2500, radiusDeg: 0.04 },
  // 山形市
  { lat: 38.2405, lng: 140.3633, coreDensity: 2500, radiusDeg: 0.04 },
  // 福島市
  { lat: 37.7500, lng: 140.4678, coreDensity: 2500, radiusDeg: 0.04 },
  // 郡山市
  { lat: 37.3999, lng: 140.3596, coreDensity: 3000, radiusDeg: 0.05 },
  // いわき市
  { lat: 37.0504, lng: 140.8878, coreDensity: 2000, radiusDeg: 0.04 },
  // 青森市
  { lat: 40.8246, lng: 140.7400, coreDensity: 2500, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 静岡県 (Shizuoka)
  // ════════════════════════════════════════════════
  // 静岡市
  { lat: 34.9756, lng: 138.3828, coreDensity: 4500, radiusDeg: 0.06 },
  // 浜松市
  { lat: 34.7108, lng: 137.7261, coreDensity: 4000, radiusDeg: 0.06 },

  // ════════════════════════════════════════════════
  // 茨城・栃木・群馬
  // ════════════════════════════════════════════════
  // 水戸市
  { lat: 36.3419, lng: 140.4468, coreDensity: 3000, radiusDeg: 0.04 },
  // つくば市
  { lat: 36.0835, lng: 140.0766, coreDensity: 3500, radiusDeg: 0.04 },
  // 宇都宮市
  { lat: 36.5551, lng: 139.8825, coreDensity: 3500, radiusDeg: 0.06 },
  // 前橋市
  { lat: 36.3911, lng: 139.0608, coreDensity: 3000, radiusDeg: 0.04 },
  // 高崎市
  { lat: 36.3221, lng: 139.0030, coreDensity: 3000, radiusDeg: 0.04 },

  // ════════════════════════════════════════════════
  // 沖縄 (Okinawa)
  // ════════════════════════════════════════════════
  // 那覇市
  { lat: 26.3344, lng: 127.8015, coreDensity: 8500, radiusDeg: 0.04 },
  // 沖縄市
  { lat: 26.3342, lng: 127.8056, coreDensity: 5000, radiusDeg: 0.03 },
  // 浦添市
  { lat: 26.3460, lng: 127.7221, coreDensity: 7000, radiusDeg: 0.02 },
];

// ─── Prefecture-level base rural density ───
// Approximate population density outside of cities, by rough latitude bands
// and known regional characteristics (people/km²).
interface RegionalDensity {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  density: number; // people/km² for rural areas
}

const REGIONAL_RURAL_DENSITIES: RegionalDensity[] = [
  // 北海道 (sparse)
  { minLat: 41.0, maxLat: 46.0, minLng: 139.0, maxLng: 146.0, density: 15 },
  // 東北 (moderate rural)
  { minLat: 37.0, maxLat: 41.0, minLng: 138.0, maxLng: 142.0, density: 60 },
  // 関東平野 (dense rural)
  { minLat: 35.0, maxLat: 37.0, minLng: 138.5, maxLng: 141.0, density: 200 },
  // 中部山岳 (sparse)
  { minLat: 35.5, maxLat: 37.5, minLng: 136.0, maxLng: 139.0, density: 50 },
  // 東海 (moderate)
  { minLat: 34.5, maxLat: 35.5, minLng: 136.0, maxLng: 139.0, density: 150 },
  // 近畿 (moderate-dense)
  { minLat: 34.0, maxLat: 35.5, minLng: 134.0, maxLng: 136.5, density: 150 },
  // 中国地方 (moderate)
  { minLat: 33.5, maxLat: 35.5, minLng: 130.5, maxLng: 134.0, density: 80 },
  // 四国 (moderate)
  { minLat: 32.5, maxLat: 34.5, minLng: 132.0, maxLng: 134.5, density: 80 },
  // 北九州・筑豊 (moderate-dense)
  { minLat: 33.3, maxLat: 34.0, minLng: 130.0, maxLng: 131.5, density: 150 },
  // 南九州 (moderate)
  { minLat: 31.0, maxLat: 33.5, minLng: 129.5, maxLng: 132.0, density: 80 },
  // 沖縄 (moderate)
  { minLat: 24.0, maxLat: 27.0, minLng: 122.0, maxLng: 129.0, density: 100 },
];

/**
 * Estimate population density for a SINGLE CELL based on its coordinates.
 *
 * Uses a distance-weighted approach from known city centers,
 * with regional rural density as baseline instead of flat 20.
 *
 * Returns people per km².
 */
function estimateCellDensity(lat: number, lng: number): number {
  let maxContribution = 0;

  for (const city of CITY_DENSITY_POINTS) {
    const dLat = (lat - city.lat) * 111.32;
    const dLng = (lng - city.lng) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const d = Math.sqrt(dLat * dLat + dLng * dLng);
    const radiusKm = city.radiusDeg * 111.32;

    if (d < radiusKm) {
      // Inside the urban area - density falls off with distance from center
      const ratio = d / radiusKm;
      const contribution = city.coreDensity * Math.pow(1 - ratio, 1.5);
      maxContribution = Math.max(maxContribution, contribution);
    } else if (d < radiusKm * 2.5) {
      // Suburban fringe - extended with gentler falloff
      const ratio = (d - radiusKm) / (radiusKm * 1.5);
      const contribution = city.coreDensity * 0.15 * Math.pow(1 - ratio, 2);
      maxContribution = Math.max(maxContribution, contribution);
    }
  }

  if (maxContribution > 0) {
    return Math.round(maxContribution);
  }

  // No city influence - use regional rural density
  return getRegionalRuralDensity(lat, lng);
}

/**
 * Get the rural baseline density for a given coordinate based on region.
 */
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
  // Default for unmatched areas (e.g., small islands)
  return 30;
}
