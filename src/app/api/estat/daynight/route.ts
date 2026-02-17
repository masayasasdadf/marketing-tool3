import { NextRequest, NextResponse } from "next/server";
import type { DayNightItem } from "@/types";

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

    // e-Stat 昼間人口・夜間人口 statsDataId
    // 国勢調査 従業地・通学地集計 昼間人口
    const url = new URL("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData");
    url.searchParams.set("appId", appId);
    url.searchParams.set("statsDataId", "0000010102");
    url.searchParams.set("sectionHeaderFlg", "2");
    url.searchParams.set("limit", "10000");
    if (prefCode) {
      url.searchParams.set("cdArea", prefCode);
    }

    const res = await fetch(url.toString());
    const data = await res.json();

    const values = data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

    if (!Array.isArray(values) || values.length === 0) {
      return NextResponse.json({
        items: [],
        supported: false,
        note: "昼夜間人口データはこの地域では現在取得できません。データの捏造は行いません。",
        source: "e-Stat",
      });
    }

    // Parse day/night population data
    const itemMap = new Map<string, DayNightItem>();

    for (const v of values) {
      const code = v["@area"] || "";
      const name = v["@area_name"] || code;
      const value = parseInt(v["$"] || "0", 10);
      const cat = v["@cat01"] || "";

      if (!code || isNaN(value)) continue;

      if (!itemMap.has(code)) {
        itemMap.set(code, {
          code,
          name,
          dayPopulation: null,
          nightPopulation: null,
          ratio: null,
        });
      }

      const item = itemMap.get(code)!;
      // Heuristic: categorize based on category code
      if (cat.includes("昼") || cat.includes("day")) {
        item.dayPopulation = value;
      } else if (cat.includes("夜") || cat.includes("night")) {
        item.nightPopulation = value;
      } else if (!item.nightPopulation) {
        // First value assumed as night (resident) population
        item.nightPopulation = value;
      }
    }

    const items: DayNightItem[] = [];
    for (const item of itemMap.values()) {
      if (item.dayPopulation !== null && item.nightPopulation !== null && item.nightPopulation > 0) {
        item.ratio = Math.round((item.dayPopulation / item.nightPopulation) * 100) / 100;
      }
      items.push(item);
    }

    items.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

    return NextResponse.json({
      items: items.slice(0, 100),
      supported: items.length > 0,
      note: items.length === 0
        ? "昼夜間人口データはこの地域では現在取得できません。データの捏造は行いません。"
        : undefined,
      source: "e-Stat 国勢調査",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
