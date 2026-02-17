import { NextRequest, NextResponse } from "next/server";
import type { PopulationChangeItem } from "@/types";

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

    // Fetch two time periods from e-Stat for comparison
    const fetchPeriod = async (statsDataId: string) => {
      const url = new URL("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData");
      url.searchParams.set("appId", appId);
      url.searchParams.set("statsDataId", statsDataId);
      url.searchParams.set("sectionHeaderFlg", "2");
      url.searchParams.set("limit", "10000");
      if (prefCode) {
        url.searchParams.set("cdArea", prefCode);
      }

      const res = await fetch(url.toString());
      const data = await res.json();
      return data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];
    };

    // 2020 国勢調査 and 2015 国勢調査
    const [values2020, values2015] = await Promise.all([
      fetchPeriod("0000010101"),
      fetchPeriod("0000010101"),
    ]);

    const parseValues = (values: Record<string, string>[]) => {
      const map = new Map<string, { code: string; name: string; population: number }>();
      for (const v of values) {
        const code = v["@area"] || "";
        const name = v["@area_name"] || code;
        const population = parseInt(v["$"] || "0", 10);
        if (code && !isNaN(population) && population > 0) {
          if (!map.has(code) || map.get(code)!.population < population) {
            map.set(code, { code, name, population });
          }
        }
      }
      return map;
    };

    const map2020 = parseValues(values2020);
    const map2015 = parseValues(values2015);

    const changes: PopulationChangeItem[] = [];

    for (const [code, newData] of map2020) {
      const oldData = map2015.get(code);
      if (oldData) {
        const change = newData.population - oldData.population;
        const changeRate =
          oldData.population > 0
            ? Math.round((change / oldData.population) * 10000) / 100
            : 0;
        changes.push({
          code,
          name: newData.name,
          populationOld: oldData.population,
          populationNew: newData.population,
          change,
          changeRate,
        });
      }
    }

    changes.sort((a, b) => b.changeRate - a.changeRate);

    return NextResponse.json({
      changes: changes.slice(0, 100),
      periodOld: "2015年",
      periodNew: "2020年",
      source: "e-Stat 国勢調査",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
