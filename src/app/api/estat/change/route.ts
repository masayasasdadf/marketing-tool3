import { NextRequest, NextResponse } from "next/server";
import type { PopulationChangeItem } from "@/types";
import { fetchSheetData } from "@/lib/sheets-reader";
import { resolveAreaName } from "@/lib/area-name-resolver";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const prefCode = searchParams.get("prefCode") || "";

    // ─── 優先: スプレッドシートからデータ取得 ───
    // Sheet gid=0 が2020年、gid=2 が2015年のデータ（あれば）
    const sheet2020 = await fetchSheetData(0);
    const sheet2015 = await fetchSheetData(2);

    if (sheet2020.length > 0 && sheet2015.length > 0) {
      const prefNum = prefCode ? parseInt(prefCode, 10) : 0;
      const minCode = prefNum * 1000;
      const maxCode = (prefNum + 1) * 1000;

      const filter = (rows: typeof sheet2020) =>
        rows.filter((r) => {
          if (r.itemCode !== "0000A") return false;
          if (!prefCode) return true;
          const code = parseInt(r.areaCode, 10);
          return code >= minCode && code < maxCode;
        });

      const data2020 = new Map(
        filter(sheet2020).map((r) => [String(parseInt(r.areaCode, 10)), r.value])
      );
      const data2015 = new Map(
        filter(sheet2015).map((r) => [String(parseInt(r.areaCode, 10)), r.value])
      );

      const changes: PopulationChangeItem[] = [];
      for (const [code, newPop] of data2020) {
        const oldPop = data2015.get(code);
        if (oldPop && oldPop > 0) {
          const change = newPop - oldPop;
          const changeRate = Math.round((change / oldPop) * 10000) / 100;
          const name = await resolveAreaName(code);
          changes.push({
            code,
            name,
            populationOld: oldPop,
            populationNew: newPop,
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
        // 名前が数字のみなら解決
        let name = newData.name;
        if (/^\d+$/.test(name)) {
          name = await resolveAreaName(code);
        }
        changes.push({
          code,
          name,
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
