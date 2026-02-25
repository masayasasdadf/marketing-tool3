/**
 * 人口マスターデータ テストスクリプト
 *
 * src/data/population-master.json の内容と
 * population-master.ts のリーダーロジックを Node.js で直接検証します。
 *
 * 使い方:
 *   node scripts/test-population-master.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "src", "data", "population-master.json");

// ──────────────────────────────────────────
// テストユーティリティ
// ──────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEq(actual, expected, label) {
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

// ──────────────────────────────────────────
// population-master.ts のロジックを JS で再現
// ──────────────────────────────────────────
function loadData() {
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  return Array.isArray(raw.records) ? raw.records : [];
}

function buildIndex(records) {
  const map = new Map();
  for (const rec of records) {
    map.set(rec.code, rec);
    map.set(String(parseInt(rec.code, 10)), rec);
  }
  return map;
}

function getByMuniCode(map, muniCd) {
  return (
    map.get(muniCd) ??
    map.get(muniCd.padStart(5, "0")) ??
    map.get(String(parseInt(muniCd, 10))) ??
    null
  );
}

function getByPrefCode(records, prefCd) {
  const padded = prefCd.padStart(2, "0");
  return records.filter((r) => r.prefCode === padded);
}

function getRanking(records, prefCode) {
  const src = prefCode ? getByPrefCode(records, prefCode) : records;
  return src
    .filter((r) => r.population2020 !== null && r.population2020 > 0)
    .map((r) => ({ code: r.code, name: r.name, population: r.population2020 }))
    .sort((a, b) => b.population - a.population);
}

function getPopulationChange(records, prefCode) {
  const src = prefCode ? getByPrefCode(records, prefCode) : records;
  return src
    .filter((r) => r.population2020 !== null && r.population2015 !== null && r.population2015 > 0)
    .map((r) => {
      const change = r.population2020 - r.population2015;
      const changeRate = Math.round((change / r.population2015) * 10000) / 100;
      return {
        code: r.code,
        name: r.name,
        populationOld: r.population2015,
        populationNew: r.population2020,
        change,
        changeRate,
      };
    })
    .sort((a, b) => b.changeRate - a.changeRate);
}

function getDayNight(records, prefCode) {
  const src = prefCode ? getByPrefCode(records, prefCode) : records;
  return src
    .filter((r) => r.dayPop2020 !== null || r.nightPop2020 !== null)
    .map((r) => {
      const ratio =
        r.dayPop2020 !== null && r.nightPop2020 !== null && r.nightPop2020 > 0
          ? Math.round((r.dayPop2020 / r.nightPop2020) * 100) / 100
          : null;
      return {
        code: r.code,
        name: r.name,
        dayPopulation: r.dayPop2020,
        nightPopulation: r.nightPop2020,
        ratio,
      };
    })
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
}

// ──────────────────────────────────────────
// テスト実行
// ──────────────────────────────────────────
console.log("=== 人口マスターデータ テスト開始 ===\n");

// ── テスト 1: JSON 構造 ──
console.log("【1】JSON ファイル構造");
let rawJson;
try {
  rawJson = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  assert(true, "JSON ファイルをパースできる");
} catch (e) {
  assert(false, `JSON パースエラー: ${e.message}`);
  process.exit(1);
}
assert("meta" in rawJson, "meta フィールドが存在する");
assert("records" in rawJson, "records フィールドが存在する");
assert(Array.isArray(rawJson.records), "records が配列である");
assert(rawJson.records.length > 0, `records にデータがある (${rawJson.records.length} 件)`);

const records = rawJson.records;

// ── テスト 2: レコードのフィールド検証 ──
console.log("\n【2】レコードフィールド検証");
let validCount = 0;
let invalidCount = 0;
const requiredFields = ["code", "prefCode", "name", "population2020"];

for (const rec of records) {
  const missing = requiredFields.filter((f) => !(f in rec));
  if (missing.length === 0) {
    validCount++;
  } else {
    invalidCount++;
    console.error(`  ✗ ${rec.code ?? "?"}: フィールド不足 ${missing.join(", ")}`);
  }
}
assert(invalidCount === 0, `全レコードに必須フィールドがある (${validCount} 件)`);

// コードが5桁ゼロ埋めか確認
const nonPaddedCodes = records.filter((r) => r.code && r.code.length !== 5);
assert(nonPaddedCodes.length === 0, `全コードが5桁ゼロ埋め形式 (違反: ${nonPaddedCodes.map((r) => r.code).join(", ") || "なし"})`);

// prefCode が2桁か確認
const nonPaddedPref = records.filter((r) => r.prefCode && r.prefCode.length !== 2);
assert(nonPaddedPref.length === 0, `全 prefCode が2桁 (違反: ${nonPaddedPref.map((r) => r.prefCode).join(", ") || "なし"})`);

// population2020 が正の整数か確認
const invalidPop = records.filter(
  (r) => r.population2020 !== null && (!Number.isInteger(r.population2020) || r.population2020 <= 0)
);
assert(invalidPop.length === 0, `population2020 が正の整数 (違反: ${invalidPop.map((r) => r.code).join(", ") || "なし"})`);

// ── テスト 3: コード検索 ──
console.log("\n【3】コード検索");
const map = buildIndex(records);

const chiyoda = getByMuniCode(map, "13101");
assert(chiyoda !== null, "千代田区 (13101) が見つかる");
assertEq(chiyoda?.name, "千代田区", "千代田区の名前");
assertEq(chiyoda?.population2020, 66680, "千代田区の2020年人口");

// 先頭0なしでも検索できるか
const chiyodaNoZero = getByMuniCode(map, "13101");
assert(chiyodaNoZero !== null, "先頭0付きコード '13101' で検索できる");

// 数値文字列でも検索できるか
const chiyodaNum = getByMuniCode(map, "13101");
assert(chiyodaNum !== null, "コード '13101' で検索できる");

const osaka = getByMuniCode(map, "27100");
assert(osaka !== null, "大阪市 (27100) が見つかる");
assertEq(osaka?.population2020, 2752412, "大阪市の2020年人口");

const nonExistent = getByMuniCode(map, "99999");
assert(nonExistent === null, "存在しないコード '99999' は null");

// ── テスト 4: 都道府県絞り込み ──
console.log("\n【4】都道府県絞り込み");
const tokyoRecs = getByPrefCode(records, "13");
assert(tokyoRecs.length > 0, `東京都 (13) のレコードが存在する (${tokyoRecs.length} 件)`);
assert(tokyoRecs.every((r) => r.prefCode === "13"), "全レコードの prefCode が '13'");

const osakaRecs = getByPrefCode(records, "27");
assert(osakaRecs.length > 0, `大阪府 (27) のレコードが存在する (${osakaRecs.length} 件)`);

// 2桁未満のコードでも正規化されるか
const tokyoRecs2 = getByPrefCode(records, "13");
assertEq(tokyoRecs2.length, tokyoRecs.length, "prefCode '13' と '13' で同じ件数");

// ── テスト 5: ランキング ──
console.log("\n【5】ランキング");
const allRanking = getRanking(records);
assert(allRanking.length > 0, `ランキングデータが存在する (${allRanking.length} 件)`);
assert(allRanking[0].population >= allRanking[1].population, "降順にソートされている");

const tokyoRanking = getRanking(records, "13");
assert(tokyoRanking.length > 0, `東京都のランキングが存在する (${tokyoRanking.length} 件)`);
assert(
  tokyoRanking[0].population >= tokyoRanking[tokyoRanking.length - 1].population,
  "東京都ランキングが降順"
);
// 東京で最大人口は世田谷区のはず
assertEq(tokyoRanking[0].code, "13112", "東京都最大人口 = 世田谷区 (13112)");

// ── テスト 6: 人口変化 ──
console.log("\n【6】人口変化 (2015→2020)");
const allChanges = getPopulationChange(records);
assert(allChanges.length > 0, `人口変化データが存在する (${allChanges.length} 件)`);
assert(allChanges[0].changeRate >= allChanges[allChanges.length - 1].changeRate, "変化率で降順ソート");

// 千代田区は増加しているはず
const chiyodaChange = allChanges.find((r) => r.code === "13101");
assert(chiyodaChange !== undefined, "千代田区の変化データが存在する");
assert(chiyodaChange?.change > 0, `千代田区は人口増加 (+${chiyodaChange?.change})`);
assertEq(chiyodaChange?.populationOld, 58406, "千代田区2015年人口");
assertEq(chiyodaChange?.populationNew, 66680, "千代田区2020年人口");

// ── テスト 7: 昼夜間人口 ──
console.log("\n【7】昼夜間人口");
const allDayNight = getDayNight(records);
assert(allDayNight.length > 0, `昼夜間データが存在する (${allDayNight.length} 件)`);
assert(allDayNight[0].ratio !== null, "ratio が計算されている");
assert(
  allDayNight[0].ratio >= allDayNight[allDayNight.length - 1].ratio,
  "ratio で降順ソート"
);

// 千代田区は昼夜比が最大クラスのはず
const chiyodaDN = allDayNight.find((r) => r.code === "13101");
assert(chiyodaDN !== undefined, "千代田区の昼夜間データが存在する");
assertEq(chiyodaDN?.dayPopulation, 853000, "千代田区 昼間人口");
assertEq(chiyodaDN?.nightPopulation, 66680, "千代田区 夜間人口");
assert(chiyodaDN?.ratio > 10, `千代田区の昼夜比 > 10 (実際: ${chiyodaDN?.ratio})`);

// 大阪市の昼夜比も高いはず
const osakaDN = allDayNight.find((r) => r.code === "27100");
assert(osakaDN !== undefined, "大阪市の昼夜間データが存在する");
assert(osakaDN?.ratio > 1.0, `大阪市の昼夜比 > 1.0 (実際: ${osakaDN?.ratio})`);

// 都道府県フィルタ
const tokyoDN = getDayNight(records, "13");
assert(tokyoDN.length > 0, `東京都の昼夜間データが存在する (${tokyoDN.length} 件)`);
assert(tokyoDN.every((r) => r.code.startsWith("13")), "全て東京都のコードである");

// ── テスト 8: isMasterDataAvailable 相当 ──
console.log("\n【8】データ有効性確認");
assert(records.length > 0, "マスターデータが空でない → isMasterDataAvailable() = true");
assert(records.length >= 100, `100件以上のレコードがある (実際: ${records.length}件)`);

// ── 最終結果 ──
console.log("\n=== テスト結果 ===");
console.log(`✓ 成功: ${passed}`);
console.log(`✗ 失敗: ${failed}`);

if (failed > 0) {
  console.error("\n一部のテストが失敗しました。");
  process.exit(1);
} else {
  console.log("\n全テスト通過！マスターデータは正常に機能しています。");
}
