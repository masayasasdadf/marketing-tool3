/**
 * 人口マスターデータリーダー
 *
 * src/data/population-master.json から市区町村別人口データを提供します。
 * データは scripts/fetch-population-master.mjs で事前に生成してください。
 *
 * シートリーダー互換の関数も提供し、既存コードの置き換えを容易にします。
 */

export interface MunicipalityRecord {
  /** 5桁市区町村コード (例: "01101") */
  code: string;
  /** 都道府県コード (例: "01") */
  prefCode: string;
  /** 市区町村名 (例: "札幌市中央区") */
  name: string;
  /** 2020年 総人口 */
  population2020: number | null;
  /** 2015年 総人口 */
  population2015: number | null;
  /** 2020年 昼間人口 */
  dayPop2020: number | null;
  /** 2020年 夜間人口 (常住人口) */
  nightPop2020: number | null;
}

interface MasterData {
  meta: {
    generatedAt: string;
    source: string;
    totalMunicipalities: number;
  };
  records: MunicipalityRecord[];
}

// ── モジュールレベルキャッシュ ──
let _data: MunicipalityRecord[] | null = null;
let _byCode: Map<string, MunicipalityRecord> | null = null;

function loadData(): MunicipalityRecord[] {
  if (_data !== null) return _data;

  try {
    // Next.js の dynamic import を避け、require で同期読み込み
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../data/population-master.json") as MasterData;
    _data = Array.isArray(raw.records) ? raw.records : [];
  } catch {
    _data = [];
  }

  return _data;
}

function getByCodeMap(): Map<string, MunicipalityRecord> {
  if (_byCode !== null) return _byCode;

  const data = loadData();
  _byCode = new Map();

  for (const rec of data) {
    _byCode.set(rec.code, rec);
    // 先頭0なし数値文字列でも引けるように
    _byCode.set(String(parseInt(rec.code, 10)), rec);
  }

  return _byCode;
}

// ────────────────────────────────────────────
// 公開 API
// ────────────────────────────────────────────

/** マスターデータが利用可能かどうか */
export function isMasterDataAvailable(): boolean {
  return loadData().length > 0;
}

/** 全レコードを返す */
export function getAllRecords(): MunicipalityRecord[] {
  return loadData();
}

/** 市区町村コードで1件取得 (null = 未登録) */
export function getByMuniCode(muniCd: string): MunicipalityRecord | null {
  const map = getByCodeMap();
  return (
    map.get(muniCd) ??
    map.get(muniCd.padStart(5, "0")) ??
    map.get(String(parseInt(muniCd, 10))) ??
    null
  );
}

/** 都道府県コードで絞り込んで取得 */
export function getByPrefCode(prefCd: string): MunicipalityRecord[] {
  const padded = prefCd.padStart(2, "0");
  return loadData().filter((r) => r.prefCode === padded);
}

// ────────────────────────────────────────────
// 各タブ向けヘルパー
// ────────────────────────────────────────────

export interface RankingRecord {
  code: string;
  name: string;
  population: number;
}

/**
 * 人口ランキング用データを返す (2020年 総人口)
 * prefCode を指定すると都道府県絞り込み
 */
export function getRanking(prefCode?: string): RankingRecord[] {
  const records = prefCode ? getByPrefCode(prefCode) : loadData();
  return records
    .filter((r) => r.population2020 !== null && r.population2020 > 0)
    .map((r) => ({ code: r.code, name: r.name, population: r.population2020! }))
    .sort((a, b) => b.population - a.population);
}

export interface ChangeRecord {
  code: string;
  name: string;
  populationOld: number;
  populationNew: number;
  change: number;
  changeRate: number;
}

/**
 * 人口変化データを返す (2015→2020)
 * prefCode を指定すると都道府県絞り込み
 */
export function getPopulationChange(prefCode?: string): ChangeRecord[] {
  const records = prefCode ? getByPrefCode(prefCode) : loadData();
  return records
    .filter((r) => r.population2020 !== null && r.population2015 !== null && r.population2015 > 0)
    .map((r) => {
      const oldPop = r.population2015!;
      const newPop = r.population2020!;
      const change = newPop - oldPop;
      const changeRate = Math.round((change / oldPop) * 10000) / 100;
      return { code: r.code, name: r.name, populationOld: oldPop, populationNew: newPop, change, changeRate };
    })
    .sort((a, b) => b.changeRate - a.changeRate);
}

export interface DayNightRecord {
  code: string;
  name: string;
  dayPopulation: number | null;
  nightPopulation: number | null;
  ratio: number | null;
}

/**
 * 昼夜間人口データを返す
 * prefCode を指定すると都道府県絞り込み
 */
export function getDayNight(prefCode?: string): DayNightRecord[] {
  const records = prefCode ? getByPrefCode(prefCode) : loadData();
  return records
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

/**
 * 市区町村の総人口を取得 (2020年)
 * population_mesh などのリアルタイム検索で使用
 */
export function getMuniPopulation(muniCd: string): number | null {
  const rec = getByMuniCode(muniCd);
  return rec?.population2020 ?? null;
}
