/**
 * Google スプレッドシート データ読み取り
 *
 * スプレッドシートを「ウェブに公開」して使う（APIキー不要）。
 * 環境変数:
 *   GOOGLE_SPREADSHEET_ID: スプレッドシートのID
 *
 * シート構成（ユーザーのスプシ準拠）:
 *   Sheet1 (男女別人口):  A=地域コード, B=項目コード(0000A=総人口), C=数値
 *   Sheet2 (昼夜間人口):  A=地域コード, B=項目コード, C=数値
 */

export interface SheetRow {
  /** 地域コード（数値文字列、先頭0省略の可能性あり） */
  areaCode: string;
  /** 項目コード (e.g. "0000A") */
  itemCode: string;
  /** 数値 */
  value: number;
}

// In-memory cache: sheetName → { data, fetchedAt }
const cache = new Map<string, { data: SheetRow[]; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * スプレッドシートからデータを取得（CSV形式）。
 * gid=0 → Sheet1, gid=1 → Sheet2 (or use sheet name).
 */
export async function fetchSheetData(gid: number = 0): Promise<SheetRow[]> {
  const cacheKey = `gid_${gid}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return [];
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[sheets-reader] Failed to fetch gid=${gid}: ${res.status} ${res.statusText}`);
      return [];
    }

    const text = await res.text();
    if (!text || text.startsWith("<!")) {
      // HTMLが返ってきた場合（権限エラー等）
      console.error(`[sheets-reader] Got HTML instead of CSV for gid=${gid}. スプレッドシートの共有設定を確認してください。`);
      return [];
    }
    const rows = parseCSV(text);
    console.log(`[sheets-reader] gid=${gid}: ${rows.length} rows loaded`);

    cache.set(cacheKey, { data: rows, fetchedAt: Date.now() });
    return rows;
  } catch (err) {
    console.error(`[sheets-reader] Error fetching gid=${gid}:`, err);
    return [];
  }
}

/**
 * 市区町村コードで人口を検索。
 * muniCd: JISコード (e.g. "13104" or "40604")
 * itemCode: 項目コード (e.g. "0000A" = 総人口)
 * gid: シート番号 (0=男女別人口, 1=昼夜間人口)
 */
export async function lookupByMuniCode(
  muniCd: string,
  itemCode: string,
  gid: number = 0
): Promise<number | null> {
  const data = await fetchSheetData(gid);
  if (data.length === 0) return null;

  // スプシは先頭0省略の可能性があるので、数値比較する
  const targetCode = parseInt(muniCd, 10);

  const row = data.find(
    (r) => parseInt(r.areaCode, 10) === targetCode && r.itemCode === itemCode
  );

  return row ? row.value : null;
}

/**
 * 都道府県コードに属する全市区町村のデータを取得。
 * prefCd: 都道府県コード (e.g. "13" → 13000番台を検索)
 */
export async function lookupByPrefCode(
  prefCd: string,
  itemCode: string,
  gid: number = 0
): Promise<SheetRow[]> {
  const data = await fetchSheetData(gid);
  if (data.length === 0) return [];

  const prefNum = parseInt(prefCd, 10);
  // 都道府県内の市区町村: prefNum * 1000 ～ (prefNum+1) * 1000
  const minCode = prefNum * 1000;
  const maxCode = (prefNum + 1) * 1000;

  return data.filter((r) => {
    const code = parseInt(r.areaCode, 10);
    return code >= minCode && code < maxCode && r.itemCode === itemCode;
  });
}

/**
 * スプレッドシートの全データを取得（指定項目コード）。
 */
export async function lookupAllByItem(
  itemCode: string,
  gid: number = 0
): Promise<SheetRow[]> {
  const data = await fetchSheetData(gid);
  return data.filter((r) => r.itemCode === itemCode);
}

function parseCSV(text: string): SheetRow[] {
  const lines = text.split("\n");
  const rows: SheetRow[] = [];

  // Skip header row (if present)
  const startIdx = lines.length > 0 && lines[0].includes("地域") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const fields = parseCSVLine(line);
    if (fields.length < 3) continue;

    const areaCode = fields[0].replace(/"/g, "").trim();
    const itemCode = fields[1].replace(/"/g, "").trim();
    const value = parseInt(fields[2].replace(/"/g, "").trim(), 10);

    if (!areaCode || isNaN(value)) continue;

    rows.push({ areaCode, itemCode, value });
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
