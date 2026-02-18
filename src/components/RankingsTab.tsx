"use client";

import { useState, useEffect } from "react";
import type { RankingItem } from "@/types";

export default function RankingsTab() {
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefCode, setPrefCode] = useState("");
  const [source, setSource] = useState("");

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (prefCode) params.set("prefCode", prefCode);
      params.set("limit", "50");

      const res = await fetch(`/api/estat/ranking?${params}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setRankings(data.rankings || []);
        setSource(data.source || "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4">市区町村 人口ランキング</h2>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="text"
          value={prefCode}
          onChange={(e) => setPrefCode(e.target.value)}
          placeholder="都道府県コード（例: 13）"
          className="w-full sm:w-48 px-3 py-2 text-sm border border-gray-300 rounded-md"
        />
        <button
          onClick={fetchRankings}
          disabled={loading}
          className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-300"
        >
          {loading ? "取得中..." : "取得"}
        </button>
        {source && <span className="text-xs text-gray-500">出典: {source}</span>}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>
      )}

      {rankings.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>コード</th>
                <th>名称</th>
                <th className="text-right">人口</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((item) => (
                <tr key={item.code}>
                  <td className="font-medium">{item.rank}</td>
                  <td className="text-gray-500">{item.code}</td>
                  <td>{item.name}</td>
                  <td className="text-right font-mono">{item.population.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && <div className="text-sm text-gray-500">データがありません</div>
      )}
    </div>
  );
}
