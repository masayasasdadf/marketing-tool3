import type { Facility, TrafficEstimate } from "@/types";
import { haversineDistance } from "./geo";

/**
 * Estimate traffic score based on facility density and main road proximity.
 * This is an ESTIMATE, not actual traffic data.
 */
export function estimateTraffic(
  gridPoints: { lat: number; lng: number }[],
  facilities: Facility[]
): TrafficEstimate[] {
  return gridPoints.map((point) => {
    // Count facilities within 500m
    const nearbyCount = facilities.filter(
      (f) => haversineDistance(point.lat, point.lng, f.lat, f.lng) < 0.5
    ).length;

    // Weight by station proximity (big traffic driver)
    const nearestStation = facilities
      .filter((f) => f.type === "train_station")
      .reduce((min, f) => {
        const d = haversineDistance(point.lat, point.lng, f.lat, f.lng);
        return d < min ? d : min;
      }, Infinity);

    let score = Math.min(nearbyCount * 15, 60);
    if (nearestStation < 0.3) score += 40;
    else if (nearestStation < 0.5) score += 25;
    else if (nearestStation < 1) score += 10;

    score = Math.min(score, 100);

    let label: string;
    if (score >= 70) label = "高（推定）";
    else if (score >= 40) label = "中（推定）";
    else label = "低（推定）";

    return { lat: point.lat, lng: point.lng, score, label };
  });
}
