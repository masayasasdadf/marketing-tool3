import { NextRequest, NextResponse } from "next/server";
import type { RankingItem } from "@/types";
import { lookupByPrefCode, lookupAllByItem } from "@/lib/sheets-reader";
import { resolveAreaName } from "@/lib/area-name-resolver";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const prefCode = searchParams.get("prefCode") || "";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // ─── 優先: スプレッドシートからデータ取得 ───
    const sheetData = prefCode
      ? await lookupByPrefCode(prefCode, "0000A", 0)
      : await lookupAllByItem("0000A", 0);

    if (sheetData.length > 0) {
      // コード → 日本語名を一括解決
      const sorted = sheetData
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);

      const rankings: RankingItem[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const name = await resolveAreaName(item.areaCode);
        rankings.push({
          code: item.areaCode,
          name,
          population: item.value,
          rank: i + 1,
        });
      }

      return NextResponse.json({
        rankings,
        source: "スプレッドシート（国勢調査）",
      });
    }

    // ─── フォールバック: e-Stat API ───
    const appId = process.env.ESTAT_APP_ID;
    if (!appId) {
      return NextResponse.json(
        { error: "ESTAT_APP_ID is not configured" },
        { status: 500 }
      );
    }

    const url = new URL("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData");
    url.searchParams.set("appId", appId);
    url.searchParams.set("statsDataId", "0000010101");
    url.searchParams.set("sectionHeaderFlg", "2");
    url.searchParams.set("limit", "10000");
    if (prefCode) {
      url.searchParams.set("cdArea", prefCode);
    }

    const res = await fetch(url.toString());
    const data = await res.json();

    const values = data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

    if (!Array.isArray(values)) {
      return NextResponse.json({ rankings: [], source: "e-Stat", note: "データが取得できませんでした" });
    }

    const municipalityMap = new Map<string, { code: string; name: string; population: number }>();

    for (const v of values) {
      const code = v["@area"] || "";
      const name = v["@area_name"] || "";
      const population = parseInt(v["$"] || "0", 10);

      if (code && !isNaN(population) && population > 0) {
        if (!municipalityMap.has(code) || (municipalityMap.get(code)!.population < population)) {
          municipalityMap.set(code, { code, name: name || code, population });
        }
      }
    }

    // e-Statの名前が数字だけの場合、名前解決する
    const sorted = Array.from(municipalityMap.values())
      .sort((a, b) => b.population - a.population)
      .slice(0, limit);

    const rankings: RankingItem[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      // 名前が数字っぽい場合は解決を試みる
      let name = item.name;
      if (/^\d+$/.test(name)) {
        name = await resolveAreaName(item.code);
      }
      rankings.push({
        code: item.code,
        name,
        population: item.population,
        rank: i + 1,
      });
    }

    return NextResponse.json({ rankings, source: "e-Stat 国勢調査" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
