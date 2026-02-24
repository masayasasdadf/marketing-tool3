/**
 * 国土地理院 逆ジオコーディングAPI
 * https://mreversegeocoder.gsi.go.jp/reverse-geocoder
 *
 * 緯度・経度 → 市区町村コード（JISコード）+ 住所文字列
 * APIキー不要・完全無料
 */

export interface GsiGeocodeResult {
  /** 市区町村コード (5桁, e.g. "13104") */
  muniCd: string;
  /** 都道府県コード (2桁, e.g. "13") */
  prefCd: string;
  /** 住所文字列 (e.g. "東京都新宿区西新宿二丁目") */
  address: string;
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GsiGeocodeResult | null> {
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder?lat=${lat}&lon=${lng}`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = await res.json();
    const results = data?.results;

    if (!results?.muniCd) return null;

    // muniCd is 6 digits (e.g. "131040"). Take first 5 for JIS code.
    const rawCode = String(results.muniCd);
    const muniCd = rawCode.length >= 5 ? rawCode.slice(0, 5) : rawCode;
    const prefCd = muniCd.slice(0, 2);
    const address = results.lv01Nm || "";

    return { muniCd, prefCd, address };
  } catch {
    return null;
  }
}
