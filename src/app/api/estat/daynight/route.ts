import { NextRequest, NextResponse } from "next/server";
import type { DayNightItem } from "@/types";
import { fetchSheetData } from "@/lib/sheets-reader";
import { resolveAreaName } from "@/lib/area-name-resolver";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const prefCode = searchParams.get("prefCode") || "";

    // ─── 優先: スプレッドシートから昼夜間人口データ取得 (gid=1) ───
    const sheetData = await fetchSheetData(1);

    if (sheetData.length > 0) {
      const prefNum = prefCode ? parseInt(prefCode, 10) : 0;
      const minCode = prefNum * 1000;
      const maxCode = (prefNum + 1) * 1000;

      // 地域コードごとにデータをグループ化
      const itemMap = new Map<string, { dayPop: number | null; nightPop: number | null }>();

      for (const row of sheetData) {
        const codeNum = parseInt(row.areaCode, 10);
        if (prefCode && (codeNum < minCode || codeNum >= maxCode)) continue;

        const key = String(codeNum);
        if (!itemMap.has(key)) {
          itemMap.set(key, { dayPop: null, nightPop: null });
        }
        const entry = itemMap.get(key)!;

        // 項目コードで昼間/夜間を判別
        // スプシの項目コードに応じて調整が必要
        const itemCode = row.itemCode;
        if (itemCode === "0" || itemCode === "0000A") {
          // 最初の項目 = 夜間人口（常住人口）
          entry.nightPop = row.value;
        } else if (itemCode === "1" || itemCode === "0001A") {
          // 2番目の項目 = 昼間人口
          entry.dayPop = row.value;
        }
      }

      const items: DayNightItem[] = [];
      for (const [code, entry] of itemMap) {
        if (entry.dayPop === null && entry.nightPop === null) continue;
        const name = await resolveAreaName(code);
        const ratio =
          entry.dayPop !== null && entry.nightPop !== null && entry.nightPop > 0
            ? Math.round((entry.dayPop / entry.nightPop) * 100) / 100
            : null;
        items.push({
          code,
          name,
          dayPopulation: entry.dayPop,
          nightPopulation: entry.nightPop,
          ratio,
        });
      }

      items.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

      return NextResponse.json({
        items: items.slice(0, 100),
        supported: items.length > 0,
        note: items.length === 0
          ? "昼夜間人口データはこの地域では現在取得できません。"
          : undefined,
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

    const eStatMap = new Map<string, DayNightItem>();

    for (const v of values) {
      const code = v["@area"] || "";
      const name = v["@area_name"] || code;
      const value = parseInt(v["$"] || "0", 10);
      const cat = v["@cat01"] || "";

      if (!code || isNaN(value)) continue;

      if (!eStatMap.has(code)) {
        eStatMap.set(code, {
          code,
          name,
          dayPopulation: null,
          nightPopulation: null,
          ratio: null,
        });
      }

      const item = eStatMap.get(code)!;
      if (cat.includes("昼") || cat.includes("day")) {
        item.dayPopulation = value;
      } else if (cat.includes("夜") || cat.includes("night")) {
        item.nightPopulation = value;
      } else if (!item.nightPopulation) {
        item.nightPopulation = value;
      }
    }

    const items: DayNightItem[] = [];
    for (const item of eStatMap.values()) {
      // 名前が数字のみなら解決
      if (/^\d+$/.test(item.name)) {
        item.name = await resolveAreaName(item.code);
      }
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
