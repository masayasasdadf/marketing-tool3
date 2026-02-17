"use client";

import { useState } from "react";
import type { Store, PopulationCell, HuffResponse } from "@/types";

interface HuffTabProps {
  stores: Store[];
  populationCells: PopulationCell[];
  onHuffResult: (result: HuffResponse) => void;
}

export default function HuffTab({ stores, populationCells, onHuffResult }: HuffTabProps) {
  const [targetStoreId, setTargetStoreId] = useState("");
  const [alpha, setAlpha] = useState(1);
  const [beta, setBeta] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HuffResponse | null>(null);

  const storesWithAttractiveness = stores.filter(
    (s) => s.attractiveness !== null && s.attractiveness > 0
  );

  const runHuff = async () => {
    if (!targetStoreId || populationCells.length === 0 || stores.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/model/huff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: populationCells,
          stores,
          targetStoreId,
          alpha,
          beta,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        onHuffResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "計算に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800 mb-4">ハフモデル分析</h2>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <div className="text-xs text-gray-500 mb-3">
          Pij = (Aj^α / dij^β) / Σ(Ak^α / dik^β)
        </div>

        {/* Target store selection */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">対象店舗</label>
          <select
            value={targetStoreId}
            onChange={(e) => setTargetStoreId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
          >
            <option value="">店舗を選択</option>
            {storesWithAttractiveness.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.storeType}) - 魅力度: {s.attractiveness}
              </option>
            ))}
          </select>
        </div>

        {/* Alpha slider */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            α (魅力度の重み): {alpha}
          </label>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={alpha}
            onChange={(e) => setAlpha(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0.1</span>
            <span>5.0</span>
          </div>
        </div>

        {/* Beta slider */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            β (距離減衰): {beta}
          </label>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={beta}
            onChange={(e) => setBeta(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0.1</span>
            <span>5.0</span>
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={runHuff}
          disabled={!targetStoreId || populationCells.length === 0 || loading}
          className="w-full py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {loading ? "計算中..." : "ハフモデル実行"}
        </button>

        {!targetStoreId && stores.length === 0 && (
          <p className="mt-2 text-xs text-amber-600">
            店舗を登録してから実行してください。Mapタブの「店舗登録」から追加できます。
          </p>
        )}
        {populationCells.length === 0 && (
          <p className="mt-2 text-xs text-amber-600">
            先にMapタブで分析を実行して人口データを取得してください。
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md">{error}</div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-gray-800 mb-3">計算結果</h3>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500">吸引人口</div>
              <div className="text-lg font-bold text-blue-700">
                {result.totalCaptured.toLocaleString()}人
              </div>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500">平均確率</div>
              <div className="text-lg font-bold text-blue-700">
                {(result.averageProbability * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Store attractiveness breakdown */}
          <h4 className="text-sm font-semibold text-gray-700 mb-2">魅力度内訳</h4>
          <div className="space-y-2">
            {storesWithAttractiveness.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    s.id === targetStoreId
                      ? "bg-blue-600"
                      : s.storeType === "自社"
                      ? "bg-blue-300"
                      : "bg-red-300"
                  }`}
                ></span>
                <span className="text-sm flex-1">
                  {s.name} ({s.storeType})
                </span>
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      s.id === targetStoreId ? "bg-blue-600" : "bg-gray-400"
                    }`}
                    style={{ width: `${s.attractiveness}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">{s.attractiveness}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-gray-400">
            ※ 結果は地図のHuffレイヤーに表示されます
          </p>
        </div>
      )}
    </div>
  );
}
