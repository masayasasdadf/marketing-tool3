"use client";

import { useState, useEffect } from "react";
import type { DayNightItem } from "@/types";

export default function DayNightTab() {
  const [items, setItems] = useState<DayNightItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [prefCode, setPrefCode] = useState("");
  const [source, setSource] = useState("");

  const fetchDayNight = async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const params = new URLSearchParams();
      if (prefCode) params.set("prefCode", prefCode);

      const res = await fetch(`/api/estat/daynight?${params}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setItems(data.items || []);
        setNote(data.note || null);
        setSource(data.source || "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDayNight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800 mb-4">昼夜間人口</h2>

      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={prefCode}
          onChange={(e) => setPrefCode(e.target.value)}
          placeholder="都道府県コード（例: 13）"
          className="px-3 py-2 text-sm border border-gray-300 rounded-md w-48"
        />
        <button
          onClick={fetchDayNight}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-300"
        >
          {loading ? "取得中..." : "取得"}
        </button>
        {source && <span className="text-xs text-gray-500">出典: {source}</span>}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>
      )}

      {note && (
        <div className="mb-4 p-3 bg-amber-50 text-amber-700 text-sm rounded-md border border-amber-200">
          {note}
        </div>
      )}

      {items.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>コード</th>
                <th>名称</th>
                <th className="text-right">昼間人口</th>
                <th className="text-right">夜間人口</th>
                <th className="text-right">昼夜比</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td className="text-gray-500">{item.code}</td>
                  <td>{item.name}</td>
                  <td className="text-right font-mono">
                    {item.dayPopulation !== null ? item.dayPopulation.toLocaleString() : "-"}
                  </td>
                  <td className="text-right font-mono">
                    {item.nightPopulation !== null ? item.nightPopulation.toLocaleString() : "-"}
                  </td>
                  <td
                    className={`text-right font-mono ${
                      item.ratio !== null && item.ratio > 1
                        ? "text-blue-600"
                        : item.ratio !== null && item.ratio < 1
                        ? "text-orange-600"
                        : ""
                    }`}
                  >
                    {item.ratio !== null ? item.ratio.toFixed(2) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading &&
        !note && <div className="text-sm text-gray-500">データがありません</div>
      )}
    </div>
  );
}
