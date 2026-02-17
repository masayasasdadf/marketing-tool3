"use client";

import type { AIAnalysisResponse } from "@/types";

interface AIPanelProps {
  analysis: AIAnalysisResponse | null;
  loading: boolean;
  error: string | null;
}

export default function AIPanel({ analysis, loading, error }: AIPanelProps) {
  if (loading) {
    return (
      <div className="absolute bottom-4 right-4 w-80 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-[1000]">
        <div className="flex items-center gap-2">
          <div className="spinner"></div>
          <span className="text-sm text-gray-600">AI分析中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute bottom-4 right-4 w-80 bg-white rounded-lg shadow-lg border border-red-200 p-4 z-[1000]">
        <div className="text-sm text-red-600">AI分析エラー: {error}</div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="absolute bottom-4 right-4 w-96 max-h-[60vh] overflow-y-auto bg-white rounded-lg shadow-lg border border-gray-200 z-[1000]">
      <div className="p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-1.5">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          AI分析結果
        </h3>

        {/* Summary */}
        <div className="mb-3 p-3 bg-blue-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1">総合評価</div>
          <div className="text-sm text-gray-700">{analysis.summary}</div>
        </div>

        {/* Signage */}
        <div className="mb-2">
          <div className="text-xs font-semibold text-gray-600 mb-0.5">看板設置適性</div>
          <div className="text-sm text-gray-700">{analysis.signageSuitability}</div>
        </div>

        {/* Opening */}
        <div className="mb-2">
          <div className="text-xs font-semibold text-gray-600 mb-0.5">出店適性</div>
          <div className="text-sm text-gray-700">{analysis.openingSuitability}</div>
        </div>

        {/* Risk */}
        <div className="mb-2">
          <div className="text-xs font-semibold text-gray-600 mb-0.5">商圏リスク</div>
          <div className="text-sm text-gray-700">{analysis.tradeAreaRisk}</div>
        </div>

        {/* Recommended Actions */}
        {analysis.recommendedActions.length > 0 && (
          <div className="mb-2">
            <div className="text-xs font-semibold text-gray-600 mb-1">推奨アクション</div>
            <ul className="text-sm text-gray-700 space-y-1">
              {analysis.recommendedActions.map((action, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5">&#x2713;</span>
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommended Points */}
        {analysis.recommendedPoints.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1">推奨地点</div>
            <div className="space-y-1">
              {analysis.recommendedPoints.map((pt, i) => (
                <div key={i} className="text-xs bg-green-50 p-2 rounded">
                  <span className="font-medium text-green-700">
                    ({pt.lat.toFixed(4)}, {pt.lng.toFixed(4)})
                  </span>
                  <span className="text-gray-600 ml-1">{pt.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
