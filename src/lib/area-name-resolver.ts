/**
 * 市区町村コード → 日本語名 変換
 *
 * 1. e-Stat メタ情報APIからコード→名前マッピングを取得（キャッシュ付き）
 * 2. フォールバック: GSI逆ジオコーディング
 * 3. 最終フォールバック: 都道府県名の静的マッピング
 */

import { reverseGeocode } from "./gsi-geocode";

// ─── 都道府県コード → 名前 (静的) ───
const PREF_NAMES: Record<string, string> = {
  "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県",
  "05": "秋田県", "06": "山形県", "07": "福島県", "08": "茨城県",
  "09": "栃木県", "10": "群馬県", "11": "埼玉県", "12": "千葉県",
  "13": "東京都", "14": "神奈川県", "15": "新潟県", "16": "富山県",
  "17": "石川県", "18": "福井県", "19": "山梨県", "20": "長野県",
  "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県",
  "25": "滋賀県", "26": "京都府", "27": "大阪府", "28": "兵庫県",
  "29": "奈良県", "30": "和歌山県", "31": "鳥取県", "32": "島根県",
  "33": "岡山県", "34": "広島県", "35": "山口県", "36": "徳島県",
  "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県",
  "41": "佐賀県", "42": "長崎県", "43": "熊本県", "44": "大分県",
  "45": "宮崎県", "46": "鹿児島県", "47": "沖縄県",
};

// ─── e-Statメタ情報キャッシュ ───
let areaNameCache: Map<string, string> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * e-Statメタ情報APIから地域コード→名前マッピングを取得。
 * statsDataId=0000010101 (国勢調査) のメタ情報を使用。
 */
async function fetchAreaNamesFromEStat(): Promise<Map<string, string>> {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return new Map();

  try {
    const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getMetaInfo?appId=${appId}&statsDataId=0000010101`;
    const res = await fetch(url);
    const data = await res.json();

    const classInfos =
      data?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ;

    if (!Array.isArray(classInfos)) return new Map();

    const map = new Map<string, string>();

    for (const classObj of classInfos) {
      // 地域分類を探す
      if (classObj["@id"] !== "area") continue;

      const classes = Array.isArray(classObj.CLASS)
        ? classObj.CLASS
        : [classObj.CLASS];

      for (const cls of classes) {
        const code = cls?.["@code"] || "";
        const name = cls?.["@name"] || "";
        if (code && name) {
          // コードを正規化（先頭0除去した数値文字列）
          map.set(code, name);
          // 先頭0付きも登録
          const padded = code.padStart(5, "0");
          map.set(padded, name);
        }
      }
    }

    return map;
  } catch {
    return new Map();
  }
}

/**
 * 地域コード→日本語名を解決する。
 * キャッシュ付きでe-Statメタ情報APIを使用。
 */
export async function resolveAreaName(code: string): Promise<string> {
  // 都道府県コード（2桁）の場合
  const padded2 = code.padStart(2, "0");
  if (code.length <= 2 && PREF_NAMES[padded2]) {
    return PREF_NAMES[padded2];
  }

  // e-Statキャッシュから取得を試みる
  if (!areaNameCache || Date.now() > cacheExpiry) {
    const fetched = await fetchAreaNamesFromEStat();
    if (fetched.size > 0) {
      areaNameCache = fetched;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  }

  if (areaNameCache) {
    // 色々な形式で検索
    const name =
      areaNameCache.get(code) ||
      areaNameCache.get(code.padStart(5, "0")) ||
      areaNameCache.get(String(parseInt(code, 10)));
    if (name) return name;
  }

  // フォールバック: 都道府県名 + コード
  const prefCd = code.padStart(5, "0").slice(0, 2);
  const prefName = PREF_NAMES[prefCd];
  if (prefName) return `${prefName}(${code})`;

  return code;
}

/**
 * 複数コードを一括で名前解決する。
 */
export async function resolveAreaNames(
  codes: string[]
): Promise<Map<string, string>> {
  // まずe-Statキャッシュを確保
  if (!areaNameCache || Date.now() > cacheExpiry) {
    const fetched = await fetchAreaNamesFromEStat();
    if (fetched.size > 0) {
      areaNameCache = fetched;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  }

  const result = new Map<string, string>();

  for (const code of codes) {
    const name = await resolveAreaName(code);
    result.set(code, name);
  }

  return result;
}

/**
 * 都道府県コードから都道府県名を取得（静的）。
 */
export function getPrefName(prefCd: string): string {
  return PREF_NAMES[prefCd.padStart(2, "0")] || prefCd;
}

/**
 * GSI逆ジオコーディングで座標から地域名を取得。
 * population_mesh などの座標ベースの処理で使用。
 */
export async function resolveAreaNameByLatLng(
  lat: number,
  lng: number
): Promise<{ muniCd: string; name: string } | null> {
  const result = await reverseGeocode(lat, lng);
  if (!result) return null;

  const name = await resolveAreaName(result.muniCd);
  return { muniCd: result.muniCd, name };
}
