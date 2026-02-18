"use client";

import type { LayerName } from "@/types";

interface SidebarProps {
  areaName: string;
  setAreaName: (v: string) => void;
  center: { lat: number; lng: number } | null;
  radiusKm: number;
  setRadiusKm: (v: number) => void;
  competitorQuery: string;
  setCompetitorQuery: (v: string) => void;
  layers: Record<LayerName, boolean>;
  toggleLayer: (name: LayerName) => void;
  onAnalyze: () => void;
  loading: boolean;
  populationSummary: { total: number; average: number; max: number; cellCount: number } | null;
}

const LAYER_NAMES: LayerName[] = [
  "人口",
  "競合店舗",
  "集客施設",
  "交通・導線",
  "生活動線",
  "登録店舗",
  "交通量（推定）",
];

const LAYER_COLORS: Record<LayerName, string> = {
  "人口": "bg-orange-400",
  "競合店舗": "bg-red-500",
  "集客施設": "bg-amber-500",
  "交通・導線": "bg-blue-500",
  "生活動線": "bg-purple-500",
  "登録店舗": "bg-blue-600",
  "交通量（推定）": "bg-gray-500",
};

export default function Sidebar({
  areaName,
  setAreaName,
  center,
  radiusKm,
  setRadiusKm,
  competitorQuery,
  setCompetitorQuery,
  layers,
  toggleLayer,
  onAnalyze,
  loading,
  populationSummary,
}: SidebarProps) {
  return (
    <div className="w-72 sm:w-80 bg-white border-r border-gray-200 flex flex-col h-full sidebar-scroll overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800 mb-3">分析設定</h2>

        {/* Area name */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">エリア名</label>
          <input
            type="text"
            value={areaName}
            onChange={(e) => setAreaName(e.target.value)}
            placeholder="例: 渋谷駅周辺"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Center */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">中心点（地図をクリック）</label>
          <div className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-md">
            {center
              ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`
              : "未設定 - 地図をクリックしてください"}
          </div>
        </div>

        {/* Radius */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            半径: {radiusKm}km
          </label>
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={radiusKm}
            onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0.5km</span>
            <span>20km</span>
          </div>
        </div>

        {/* Competitor query */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">競合検索クエリ</label>
          <input
            type="text"
            value={competitorQuery}
            onChange={(e) => setCompetitorQuery(e.target.value)}
            placeholder="例: 買取 リサイクル"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Analyze button */}
        <button
          onClick={onAnalyze}
          disabled={!center || loading}
          className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
              分析中...
            </>
          ) : (
            "分析実行"
          )}
        </button>
      </div>

      {/* Population summary */}
      {populationSummary && (
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">人口サマリ</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-blue-50 p-2 rounded">
              <div className="text-xs text-gray-500">合計</div>
              <div className="font-bold text-blue-700">{populationSummary.total.toLocaleString()}</div>
            </div>
            <div className="bg-blue-50 p-2 rounded">
              <div className="text-xs text-gray-500">平均</div>
              <div className="font-bold text-blue-700">{populationSummary.average.toLocaleString()}</div>
            </div>
            <div className="bg-blue-50 p-2 rounded">
              <div className="text-xs text-gray-500">最大</div>
              <div className="font-bold text-blue-700">{populationSummary.max.toLocaleString()}</div>
            </div>
            <div className="bg-blue-50 p-2 rounded">
              <div className="text-xs text-gray-500">セル数</div>
              <div className="font-bold text-blue-700">{populationSummary.cellCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* Layer toggles */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">レイヤー</h3>
        <div className="space-y-2">
          {LAYER_NAMES.map((name) => (
            <label
              key={name}
              className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1 rounded"
            >
              <input
                type="checkbox"
                checked={layers[name]}
                onChange={() => toggleLayer(name)}
                className="rounded border-gray-300"
              />
              <span className={`w-3 h-3 rounded-full ${LAYER_COLORS[name]}`}></span>
              {name}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
