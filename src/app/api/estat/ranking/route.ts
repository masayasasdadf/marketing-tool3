import { NextRequest, NextResponse } from "next/server";
import type { RankingItem } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const appId = process.env.ESTAT_APP_ID;
    if (!appId) {
      return NextResponse.json(
        { error: "ESTAT_APP_ID is not configured" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const prefCode = searchParams.get("prefCode") || "";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // e-Stat 国勢調査 人口等基本集計 市区町村別
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

    // Parse and extract municipality data
    const municipalityMap = new Map<string, { code: string; name: string; population: number }>();

    for (const v of values) {
      const code = v["@area"] || "";
      const name = v["@area_name"] || v["@cat01_name"] || code;
      const population = parseInt(v["$"] || "0", 10);

      if (code && !isNaN(population) && population > 0) {
        if (!municipalityMap.has(code) || (municipalityMap.get(code)!.population < population)) {
          municipalityMap.set(code, { code, name, population });
        }
      }
    }

    const sorted = Array.from(municipalityMap.values())
      .sort((a, b) => b.population - a.population)
      .slice(0, limit);

    const rankings: RankingItem[] = sorted.map((item, index) => ({
      code: item.code,
      name: item.name,
      population: item.population,
      rank: index + 1,
    }));

    return NextResponse.json({ rankings, source: "e-Stat 国勢調査" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
