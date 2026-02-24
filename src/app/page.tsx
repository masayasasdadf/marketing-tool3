"use client";

import { useState, useCallback } from "react";
import TabBar from "@/components/TabBar";
import Sidebar from "@/components/Sidebar";
import StorePanel from "@/components/StorePanel";
import DynamicMap from "@/components/DynamicMap";
import AIPanel from "@/components/AIPanel";
import RankingsTab from "@/components/RankingsTab";
import ChangesTab from "@/components/ChangesTab";
import DayNightTab from "@/components/DayNightTab";
import HuffTab from "@/components/HuffTab";
import type {
  LayerName,
  PopulationCell,
  Competitor,
  Facility,
  Store,
  HuffCellResult,
  HuffResponse,
  TrafficEstimate,
  AIAnalysisResponse,
  AIRecommendedPoint,
} from "@/types";
import { estimateTraffic } from "@/lib/traffic-estimate";

type TabName = "map" | "rankings" | "changes" | "day-night" | "huff";

const DEFAULT_LAYERS: Record<LayerName, boolean> = {
  "人口": true,
  "競合店舗": true,
  "集客施設": true,
  "交通・導線": true,
  "生活動線": true,
  "登録店舗": true,
  "交通量（推定）": false,
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabName>("map");
  const [areaName, setAreaName] = useState("");
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [competitorQuery, setCompetitorQuery] = useState("買取 リサイクル");
  const [layers, setLayers] = useState<Record<LayerName, boolean>>(DEFAULT_LAYERS);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data states
  const [populationCells, setPopulationCells] = useState<PopulationCell[]>([]);
  const [populationSummary, setPopulationSummary] = useState<{
    total: number;
    average: number;
    max: number;
    cellCount: number;
  } | null>(null);
  const [populationIsEstimate, setPopulationIsEstimate] = useState(false);
  const [municipality, setMunicipality] = useState<{
    code: string;
    name: string;
    population: number | null;
  } | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [huffResults, setHuffResults] = useState<HuffCellResult[]>([]);
  const [huffResponse, setHuffResponse] = useState<HuffResponse | null>(null);
  const [trafficEstimates, setTrafficEstimates] = useState<TrafficEstimate[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [aiPoints, setAiPoints] = useState<AIRecommendedPoint[]>([]);

  // Loading states
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const toggleLayer = (name: LayerName) => {
    setLayers((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setCenter({ lat, lng });
  }, []);

  // Fetch stores from API
  const fetchStores = async () => {
    try {
      const res = await fetch("/api/stores");
      const data = await res.json();
      if (data.stores) {
        setStores(data.stores);
      }
    } catch {
      // silently fail
    }
  };

  // Add store
  const handleAddStore = async (store: Omit<Store, "id" | "attractiveness">) => {
    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(store),
      });
      const data = await res.json();
      if (data.store) {
        await fetchStores();
      }
    } catch {
      // silently fail
    }
  };

  // Delete store
  const handleDeleteStore = async (id: string) => {
    try {
      await fetch(`/api/stores?id=${id}`, { method: "DELETE" });
      await fetchStores();
    } catch {
      // silently fail
    }
  };

  // Main analysis function
  const runAnalysis = async () => {
    if (!center) return;

    setAnalysisLoading(true);
    // On mobile, close the sidebar when analysis starts
    setSidebarOpen(false);

    try {
      // 1. Fetch population mesh
      const popRes = await fetch("/api/estat/population_mesh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: center.lat, lng: center.lng, radiusKm }),
      });
      const popData = await popRes.json();
      if (popData.cells) {
        setPopulationCells(popData.cells);
        setPopulationSummary(popData.summary);
        setPopulationIsEstimate(popData.isEstimate || false);
        setMunicipality(popData.municipality || null);
      }

      // 2. Fetch competitors
      const compRes = await fetch("/api/places/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: center.lat,
          lng: center.lng,
          radiusKm,
          query: competitorQuery,
        }),
      });
      const compData = await compRes.json();
      if (compData.competitors) {
        setCompetitors(compData.competitors);
      }

      // 3. Fetch facilities
      const facRes = await fetch("/api/places/poi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: center.lat, lng: center.lng, radiusKm }),
      });
      const facData = await facRes.json();
      if (facData.facilities) {
        setFacilities(facData.facilities);

        // 4. Estimate traffic based on facilities
        const step = radiusKm > 5 ? 0.008 : 0.004;
        const gridPoints: { lat: number; lng: number }[] = [];
        const latDelta = radiusKm / 111.32;
        const lngDelta =
          radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));

        for (let lat = center.lat - latDelta; lat <= center.lat + latDelta; lat += step) {
          for (let lng = center.lng - lngDelta; lng <= center.lng + lngDelta; lng += step) {
            gridPoints.push({ lat, lng });
          }
        }

        const traffic = estimateTraffic(gridPoints, facData.facilities);
        setTrafficEstimates(traffic);
      }

      // 5. Fetch registered stores
      await fetchStores();

      // 6. Run AI analysis
      setAiLoading(true);
      setAiError(null);
      try {
        const aiRes = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            areaName: areaName || "分析エリア",
            populationSummary: popData.summary
              ? {
                  total: popData.summary.total,
                  average: popData.summary.average,
                  max: popData.summary.max,
                }
              : null,
            competitorCount: compData.competitors?.length || 0,
            facilityDensity: facData.facilities?.length || 0,
            stores,
            huffResult: huffResponse,
          }),
        });
        const aiData = await aiRes.json();

        if (aiData.error) {
          setAiError(aiData.error);
        } else {
          setAiAnalysis(aiData);
          setAiPoints(aiData.recommendedPoints || []);
        }
      } catch (err) {
        setAiError(err instanceof Error ? err.message : "AI分析に失敗しました");
      } finally {
        setAiLoading(false);
      }
    } catch {
      // Handle error
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleHuffResult = (result: HuffResponse) => {
    setHuffResponse(result);
    setHuffResults(result.results);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-3 sm:px-4 py-2 flex items-center justify-between shrink-0">
        <h1 className="text-base sm:text-lg font-bold text-gray-800 truncate">
          {process.env.NEXT_PUBLIC_APP_NAME || "商圏分析ツール"}
        </h1>
        <span className="text-xs text-gray-400 hidden sm:inline">買取ラクダ</span>
      </header>

      {/* Tab bar */}
      <div className="shrink-0">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "map" && (
          <div className="relative h-full">
            {/* Mobile toggle button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden absolute top-3 left-3 z-[1000] bg-white rounded-lg shadow-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
              {sidebarOpen ? "閉じる" : "設定"}
            </button>

            <div className="flex h-full">
              {/* Left sidebar - hidden on mobile by default, shown via toggle */}
              <div className={`
                ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
                lg:translate-x-0 lg:relative
                absolute inset-y-0 left-0 z-[999]
                transition-transform duration-200 ease-in-out
                flex flex-col h-full bg-white shadow-lg lg:shadow-none
              `}>
                <Sidebar
                  areaName={areaName}
                  setAreaName={setAreaName}
                  center={center}
                  radiusKm={radiusKm}
                  setRadiusKm={setRadiusKm}
                  competitorQuery={competitorQuery}
                  setCompetitorQuery={setCompetitorQuery}
                  layers={layers}
                  toggleLayer={toggleLayer}
                  onAnalyze={runAnalysis}
                  loading={analysisLoading}
                  populationSummary={populationSummary}
                  populationIsEstimate={populationIsEstimate}
                  municipality={municipality}
                />
                <StorePanel
                  stores={stores}
                  onAdd={handleAddStore}
                  onDelete={handleDeleteStore}
                  center={center}
                />
              </div>

              {/* Backdrop for mobile sidebar */}
              {sidebarOpen && (
                <div
                  className="lg:hidden fixed inset-0 bg-black/30 z-[998]"
                  onClick={() => setSidebarOpen(false)}
                />
              )}

              {/* Map area */}
              <div className="flex-1 relative">
                <DynamicMap
                  center={center}
                  radiusKm={radiusKm}
                  layers={layers}
                  populationCells={populationCells}
                  competitors={competitors}
                  facilities={facilities}
                  stores={stores}
                  huffResults={huffResults}
                  trafficEstimates={trafficEstimates}
                  aiPoints={aiPoints}
                  onMapClick={handleMapClick}
                />
                <AIPanel
                  analysis={aiAnalysis}
                  loading={aiLoading}
                  error={aiError}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "rankings" && (
          <div className="h-full overflow-y-auto">
            <RankingsTab />
          </div>
        )}
        {activeTab === "changes" && (
          <div className="h-full overflow-y-auto">
            <ChangesTab />
          </div>
        )}
        {activeTab === "day-night" && (
          <div className="h-full overflow-y-auto">
            <DayNightTab />
          </div>
        )}
        {activeTab === "huff" && (
          <div className="h-full overflow-y-auto">
            <HuffTab
              stores={stores}
              populationCells={populationCells}
              onHuffResult={handleHuffResult}
            />
          </div>
        )}
      </div>
    </div>
  );
}
