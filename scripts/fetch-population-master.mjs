/**
 * 人口マスターデータ取得スクリプト
 *
 * e-Stat API から全国市区町村の人口データを取得し、
 * src/data/population-master.json に保存します。
 *
 * 使い方:
 *   ESTAT_APP_ID=your_key node scripts/fetch-population-master.mjs
 *
 * または .env ファイルがある場合:
 *   node --env-file=.env scripts/fetch-population-master.mjs
 *
 * 取得データ:
 *   - 2020年国勢調査 総人口（市区町村別）
 *   - 2015年国勢調査 総人口（市区町村別・人口変化計算用）
 *   - 2020年 昼夜間人口（市区町村別）
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "src", "data", "population-master.json");

const APP_ID = process.env.ESTAT_APP_ID;
if (!APP_ID) {
  console.error("Error: ESTAT_APP_ID 環境変数が必要です");
  console.error(
    "使い方: ESTAT_APP_ID=your_key node scripts/fetch-population-master.mjs"
  );
  process.exit(1);
}

const ESTAT_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData";

/**
 * e-Stat データセット ID
 *
 * 2020年国勢調査 人口等基本集計（市区町村）
 *   - 総人口 (総数・男・女): 0003412756
 * 2015年国勢調査 人口等基本集計（市区町村）
 *   - 総人口: 0003398257
 * 2020年国勢調査 従業地・通学地集計（昼夜間人口）
 *   - 昼間人口・夜間人口: 0003412819
 *
 * ※ 上記で取得できない場合のフォールバック:
 *   0000010101 (旧 国勢調査 総数)
 *   0000010102 (旧 昼夜間人口)
 */
const DATASET = {
  pop2020: "0003412756",
  pop2015: "0003398257",
  daynight2020: "0003412819",
  // フォールバック
  popFallback: "0000010101",
  daynightFallback: "0000010102",
};

/** e-Stat API から統計データを取得 */
async function fetchStatsData(statsDataId, extraParams = {}) {
  const url = new URL(ESTAT_BASE);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("statsDataId", statsDataId);
  url.searchParams.set("sectionHeaderFlg", "2");
  url.searchParams.set("limit", "100000");

  for (const [k, v] of Object.entries(extraParams)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const status = json?.GET_STATS_DATA?.RESULT?.STATUS;
  if (status !== 0 && status !== "0") {
    const msg = json?.GET_STATS_DATA?.RESULT?.ERROR_MSG || "Unknown error";
    throw new Error(`e-Stat API error (status=${status}): ${msg}`);
  }

  const values =
    json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
  return Array.isArray(values) ? values : [values];
}

/** e-Stat API からメタ情報（地域名）を取得 */
async function fetchAreaNames(statsDataId) {
  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getMetaInfo?appId=${APP_ID}&statsDataId=${statsDataId}`;
  const res = await fetch(url);
  if (!res.ok) return new Map();

  const json = await res.json();
  const classInfos =
    json?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ ?? [];
  const infos = Array.isArray(classInfos) ? classInfos : [classInfos];

  const map = new Map();
  for (const classObj of infos) {
    if (classObj?.["@id"] !== "area") continue;
    const classes = Array.isArray(classObj.CLASS)
      ? classObj.CLASS
      : classObj.CLASS
      ? [classObj.CLASS]
      : [];
    for (const cls of classes) {
      const code = cls?.["@code"];
      const name = cls?.["@name"];
      if (code && name) {
        map.set(code, name);
        map.set(code.padStart(5, "0"), name);
      }
    }
  }
  return map;
}

/**
 * 総人口データを市区町村コードでまとめる
 * 返値: Map<code5digit, { code, prefCode, name, population }>
 */
function parsePopulationValues(values, areaNames, itemFilter) {
  const map = new Map();

  for (const v of values) {
    const rawCode = v["@area"] ?? "";
    if (!rawCode) continue;

    // 市区町村コード（5桁）に正規化
    const code = rawCode.padStart(5, "0");
    // 都道府県単位（3桁以下）はスキップ
    if (parseInt(code, 10) % 1000 === 0) continue;

    const prefCode = code.slice(0, 2);
    const name = areaNames.get(code) ?? areaNames.get(rawCode) ?? code;
    const population = parseInt(v["$"] ?? "0", 10);

    if (isNaN(population) || population <= 0) continue;

    // 項目フィルタ（総数 = "000" or "0000A" など）
    const cat01 = v["@cat01"] ?? v["@cat"] ?? "";
    if (itemFilter && !itemFilter(cat01)) continue;

    // 同じコードで複数行ある場合、最大値（総数）を採用
    if (!map.has(code) || map.get(code).population < population) {
      map.set(code, { code, prefCode, name, population });
    }
  }

  return map;
}

/**
 * 昼夜間人口データをパース
 * 返値: Map<code5digit, { dayPop, nightPop }>
 */
function parseDayNightValues(values, areaNames) {
  const map = new Map();

  for (const v of values) {
    const rawCode = v["@area"] ?? "";
    if (!rawCode) continue;

    const code = rawCode.padStart(5, "0");
    if (parseInt(code, 10) % 1000 === 0) continue;

    const population = parseInt(v["$"] ?? "0", 10);
    if (isNaN(population) || population <= 0) continue;

    if (!map.has(code)) {
      map.set(code, { dayPop: null, nightPop: null });
    }

    const entry = map.get(code);
    const cat = (v["@cat01"] ?? v["@cat02"] ?? "").toLowerCase();

    if (cat.includes("昼") || cat.includes("day") || cat === "1" || cat === "01") {
      if (entry.dayPop === null || entry.dayPop < population) {
        entry.dayPop = population;
      }
    } else if (
      cat.includes("夜") ||
      cat.includes("night") ||
      cat === "0" ||
      cat === "00"
    ) {
      if (entry.nightPop === null || entry.nightPop < population) {
        entry.nightPop = population;
      }
    }
  }

  return map;
}

/** 指定 statsDataId を順番に試し、最初に成功したものを返す */
async function tryFetch(ids, label) {
  for (const id of ids) {
    try {
      console.log(`  [${label}] statsDataId=${id} を試みます...`);
      const values = await fetchStatsData(id);
      if (values.length > 0) {
        console.log(`  [${label}] ${values.length} 件取得成功`);
        return { id, values };
      }
      console.log(`  [${label}] データなし（0件）`);
    } catch (err) {
      console.log(`  [${label}] エラー: ${err.message}`);
    }
  }
  return { id: null, values: [] };
}

async function main() {
  console.log("=== 人口マスターデータ取得開始 ===\n");

  // ── 1. 2020年 総人口 ──
  console.log("1. 2020年 総人口を取得中...");
  const { id: popId2020, values: popValues2020 } = await tryFetch(
    [DATASET.pop2020, DATASET.popFallback],
    "pop2020"
  );
  const areaNames2020 =
    popId2020 ? await fetchAreaNames(popId2020) : new Map();
  const pop2020Map = parsePopulationValues(popValues2020, areaNames2020, null);
  console.log(`  → ${pop2020Map.size} 市区町村\n`);

  // ── 2. 2015年 総人口 ──
  console.log("2. 2015年 総人口を取得中...");
  const { id: popId2015, values: popValues2015 } = await tryFetch(
    [DATASET.pop2015, DATASET.popFallback],
    "pop2015"
  );
  const areaNames2015 =
    popId2015 ? await fetchAreaNames(popId2015) : new Map();
  const pop2015Map = parsePopulationValues(popValues2015, areaNames2015, null);
  console.log(`  → ${pop2015Map.size} 市区町村\n`);

  // ── 3. 2020年 昼夜間人口 ──
  console.log("3. 2020年 昼夜間人口を取得中...");
  const { values: dayNightValues } = await tryFetch(
    [DATASET.daynight2020, DATASET.daynightFallback],
    "daynight"
  );
  const dayNightMap = parseDayNightValues(dayNightValues, areaNames2020);
  console.log(`  → ${dayNightMap.size} 市区町村\n`);

  // ── 4. マージ ──
  console.log("4. データをマージ中...");
  const allCodes = new Set([
    ...pop2020Map.keys(),
    ...pop2015Map.keys(),
  ]);

  const records = [];
  for (const code of allCodes) {
    const p2020 = pop2020Map.get(code);
    const p2015 = pop2015Map.get(code);
    const dn = dayNightMap.get(code);

    const name =
      p2020?.name ??
      p2015?.name ??
      areaNames2020.get(code) ??
      areaNames2015.get(code) ??
      code;

    const prefCode = code.slice(0, 2);

    records.push({
      code,
      prefCode,
      name,
      population2020: p2020?.population ?? null,
      population2015: p2015?.population ?? null,
      dayPop2020: dn?.dayPop ?? null,
      nightPop2020: dn?.nightPop ?? null,
    });
  }

  // 都道府県コード → 市区町村コード順でソート
  records.sort((a, b) => a.code.localeCompare(b.code));
  console.log(`  → 計 ${records.length} レコード\n`);

  // ── 5. 保存 ──
  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "e-Stat 国勢調査",
      datasets: {
        pop2020: popId2020,
        pop2015: popId2015,
        daynight2020: DATASET.daynight2020,
      },
      note: "scripts/fetch-population-master.mjs で生成",
      totalMunicipalities: records.length,
    },
    records,
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf-8");

  console.log(`=== 完了: ${OUT_FILE} に保存しました ===`);
  console.log(`総市区町村数: ${records.length}`);

  const withDayNight = records.filter(
    (r) => r.dayPop2020 !== null || r.nightPop2020 !== null
  ).length;
  const withBothYears = records.filter(
    (r) => r.population2020 !== null && r.population2015 !== null
  ).length;
  console.log(`昼夜間データあり: ${withDayNight}`);
  console.log(`2015・2020両年データあり: ${withBothYears}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
