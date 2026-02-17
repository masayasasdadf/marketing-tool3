/**
 * Haversine distance between two coordinates in km
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Map facility type to UI category
 */
export function facilityCategory(
  type: string
): "集客施設" | "交通・導線" | "生活動線" {
  switch (type) {
    case "shopping_mall":
    case "supermarket":
      return "集客施設";
    case "train_station":
      return "交通・導線";
    case "hospital":
    case "school":
    case "city_hall":
      return "生活動線";
    default:
      return "生活動線";
  }
}

/**
 * Google Places type mapping
 */
export const FACILITY_TYPE_TO_GOOGLE: Record<string, string> = {
  shopping_mall: "shopping_mall",
  supermarket: "supermarket",
  train_station: "train_station",
  hospital: "hospital",
  school: "school",
  city_hall: "city_hall",
};

/**
 * Generate a bounding box from center + radius
 */
export function boundingBox(
  lat: number,
  lng: number,
  radiusKm: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos(toRad(lat)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
