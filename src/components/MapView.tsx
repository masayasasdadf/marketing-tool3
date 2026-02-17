"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
  PopulationCell,
  Competitor,
  Facility,
  Store,
  HuffCellResult,
  TrafficEstimate,
  AIRecommendedPoint,
  LayerName,
} from "@/types";

// Fix default marker icon
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface MapViewProps {
  center: { lat: number; lng: number } | null;
  radiusKm: number;
  layers: Record<LayerName, boolean>;
  populationCells: PopulationCell[];
  competitors: Competitor[];
  facilities: Facility[];
  stores: Store[];
  huffResults: HuffCellResult[];
  trafficEstimates: TrafficEstimate[];
  aiPoints: AIRecommendedPoint[];
  onMapClick: (lat: number, lng: number) => void;
}

const ICON_COMPETITOR = L.divIcon({
  html: '<div style="background:#ef4444;width:12px;height:12px;border-radius:50%;border:2px solid #fff;"></div>',
  iconSize: [12, 12],
  className: "",
});

const ICON_SHOPPING = L.divIcon({
  html: '<div style="background:#f59e0b;width:10px;height:10px;border-radius:50%;border:2px solid #fff;"></div>',
  iconSize: [10, 10],
  className: "",
});

const ICON_TRANSPORT = L.divIcon({
  html: '<div style="background:#3b82f6;width:10px;height:10px;border-radius:2px;border:2px solid #fff;"></div>',
  iconSize: [10, 10],
  className: "",
});

const ICON_LIFE = L.divIcon({
  html: '<div style="background:#8b5cf6;width:10px;height:10px;border-radius:2px;border:2px solid #fff;"></div>',
  iconSize: [10, 10],
  className: "",
});

const ICON_STORE_OWN = L.divIcon({
  html: '<div style="background:#2563eb;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [16, 16],
  className: "",
});

const ICON_STORE_RIVAL = L.divIcon({
  html: '<div style="background:#dc2626;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [16, 16],
  className: "",
});

const ICON_AI = L.divIcon({
  html: '<div style="background:#16a34a;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
  iconSize: [14, 14],
  className: "",
});

function popColor(population: number, max: number): string {
  const ratio = max > 0 ? population / max : 0;
  if (ratio > 0.8) return "#dc262680";
  if (ratio > 0.6) return "#f97316a0";
  if (ratio > 0.4) return "#eab30890";
  if (ratio > 0.2) return "#22c55e70";
  return "#3b82f650";
}

function huffColor(probability: number): string {
  if (probability > 0.6) return "#dc2626c0";
  if (probability > 0.4) return "#f97316a0";
  if (probability > 0.2) return "#eab30890";
  if (probability > 0.1) return "#22c55e70";
  return "#3b82f640";
}

export default function MapView({
  center,
  radiusKm,
  layers,
  populationCells,
  competitors,
  facilities,
  stores,
  huffResults,
  trafficEstimates,
  aiPoints,
  onMapClick,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupsRef = useRef<Record<string, L.LayerGroup>>({});
  const circleRef = useRef<L.Circle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [35.6812, 139.7671],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Create layer groups
    const groupNames = [
      "population",
      "competitors",
      "shopping",
      "transport",
      "life",
      "stores",
      "traffic",
      "huff",
      "ai",
    ];
    for (const name of groupNames) {
      layerGroupsRef.current[name] = L.layerGroup().addTo(map);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update onMapClick ref
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.off("click");
    mapRef.current.on("click", (e: L.LeafletMouseEvent) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });
  }, [onMapClick]);

  // Center and radius circle
  useEffect(() => {
    if (!mapRef.current) return;

    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }

    if (center) {
      mapRef.current.setView([center.lat, center.lng], getZoomForRadius(radiusKm));
      circleRef.current = L.circle([center.lat, center.lng], {
        radius: radiusKm * 1000,
        color: "#2563eb",
        fillColor: "#2563eb",
        fillOpacity: 0.05,
        weight: 2,
        dashArray: "5, 5",
      }).addTo(mapRef.current);
    }
  }, [center, radiusKm]);

  // Population cells
  const updatePopulation = useCallback(() => {
    const group = layerGroupsRef.current["population"];
    if (!group) return;
    group.clearLayers();

    if (!layers["人口"] || populationCells.length === 0) return;

    const maxPop = Math.max(...populationCells.map((c) => c.population));
    for (const cell of populationCells) {
      L.rectangle(
        [
          [cell.lat - 0.0025, cell.lng - 0.003125],
          [cell.lat + 0.0025, cell.lng + 0.003125],
        ],
        {
          color: popColor(cell.population, maxPop),
          fillColor: popColor(cell.population, maxPop),
          fillOpacity: 0.6,
          weight: 0,
        }
      )
        .bindPopup(`人口: ${cell.population.toLocaleString()}人<br>メッシュ: ${cell.meshCode}`)
        .addTo(group);
    }
  }, [layers, populationCells]);

  // Competitors
  const updateCompetitors = useCallback(() => {
    const group = layerGroupsRef.current["competitors"];
    if (!group) return;
    group.clearLayers();

    if (!layers["競合店舗"]) return;

    for (const c of competitors) {
      L.marker([c.lat, c.lng], { icon: ICON_COMPETITOR })
        .bindPopup(
          `<strong>${c.name}</strong><br>` +
            `評価: ${c.rating ?? "-"} (${c.reviewCount}件)<br>` +
            `${c.address || ""}<br>` +
            `<a href="${c.googleMapsUrl}" target="_blank" rel="noopener">Google Maps</a>`
        )
        .addTo(group);
    }
  }, [layers, competitors]);

  // Facilities
  const updateFacilities = useCallback(() => {
    const shopping = layerGroupsRef.current["shopping"];
    const transport = layerGroupsRef.current["transport"];
    const life = layerGroupsRef.current["life"];

    if (shopping) shopping.clearLayers();
    if (transport) transport.clearLayers();
    if (life) life.clearLayers();

    for (const f of facilities) {
      let group: L.LayerGroup | undefined;
      let icon: L.DivIcon = ICON_LIFE;
      if (f.category === "集客施設" && layers["集客施設"]) {
        group = shopping;
        icon = ICON_SHOPPING;
      } else if (f.category === "交通・導線" && layers["交通・導線"]) {
        group = transport;
        icon = ICON_TRANSPORT;
      } else if (f.category === "生活動線" && layers["生活動線"]) {
        group = life;
        icon = ICON_LIFE;
      }

      if (group) {
        L.marker([f.lat, f.lng], { icon })
          .bindPopup(`<strong>${f.name}</strong><br>${f.category}`)
          .addTo(group);
      }
    }
  }, [layers, facilities]);

  // Stores
  const updateStores = useCallback(() => {
    const group = layerGroupsRef.current["stores"];
    if (!group) return;
    group.clearLayers();

    if (!layers["登録店舗"]) return;

    for (const s of stores) {
      const icon = s.storeType === "自社" ? ICON_STORE_OWN : ICON_STORE_RIVAL;
      L.marker([s.lat, s.lng], { icon })
        .bindPopup(
          `<strong>${s.name}</strong><br>` +
            `種別: ${s.storeType}<br>` +
            `魅力度: ${s.attractiveness ?? "-"}<br>` +
            `面積: ${s.areaSqm ?? "-"}㎡ / 駐車場: ${s.parkingSpaces ?? "-"}台`
        )
        .addTo(group);
    }
  }, [layers, stores]);

  // Huff results
  const updateHuff = useCallback(() => {
    const group = layerGroupsRef.current["huff"];
    if (!group) return;
    group.clearLayers();

    if (huffResults.length === 0) return;

    for (const cell of huffResults) {
      L.rectangle(
        [
          [cell.lat - 0.0025, cell.lng - 0.003125],
          [cell.lat + 0.0025, cell.lng + 0.003125],
        ],
        {
          color: huffColor(cell.probability),
          fillColor: huffColor(cell.probability),
          fillOpacity: 0.7,
          weight: 0,
        }
      )
        .bindPopup(
          `確率: ${(cell.probability * 100).toFixed(1)}%<br>` +
            `吸引人口: ${Math.round(cell.capturedPopulation).toLocaleString()}人`
        )
        .addTo(group);
    }
  }, [huffResults]);

  // Traffic estimates
  const updateTraffic = useCallback(() => {
    const group = layerGroupsRef.current["traffic"];
    if (!group) return;
    group.clearLayers();

    if (!layers["交通量（推定）"]) return;

    for (const t of trafficEstimates) {
      const color =
        t.score >= 70 ? "#dc262680" : t.score >= 40 ? "#f9731680" : "#3b82f650";
      L.circleMarker([t.lat, t.lng], {
        radius: 6,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 1,
      })
        .bindPopup(`交通量（推定）: ${t.label}<br>スコア: ${t.score}`)
        .addTo(group);
    }
  }, [layers, trafficEstimates]);

  // AI points
  const updateAI = useCallback(() => {
    const group = layerGroupsRef.current["ai"];
    if (!group) return;
    group.clearLayers();

    for (const p of aiPoints) {
      L.marker([p.lat, p.lng], { icon: ICON_AI })
        .bindPopup(`<strong>AI推奨地点</strong><br>${p.reason}`)
        .addTo(group);
    }
  }, [aiPoints]);

  // Run all layer updates
  useEffect(() => { updatePopulation(); }, [updatePopulation]);
  useEffect(() => { updateCompetitors(); }, [updateCompetitors]);
  useEffect(() => { updateFacilities(); }, [updateFacilities]);
  useEffect(() => { updateStores(); }, [updateStores]);
  useEffect(() => { updateHuff(); }, [updateHuff]);
  useEffect(() => { updateTraffic(); }, [updateTraffic]);
  useEffect(() => { updateAI(); }, [updateAI]);

  return <div ref={containerRef} className="w-full h-full" />;
}

function getZoomForRadius(km: number): number {
  if (km <= 1) return 15;
  if (km <= 2) return 14;
  if (km <= 5) return 13;
  if (km <= 10) return 12;
  return 11;
}
