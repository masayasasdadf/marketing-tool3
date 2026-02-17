import type { Store, AttractivenessWeights } from "@/types";

const DEFAULT_WEIGHTS: AttractivenessWeights = {
  areaSqm: 0.35,
  parkingSpaces: 0.25,
  reviews: 0.20,
  rating: 0.10,
  mainRoad: 0.05,
  businessHours: 0.05,
};

interface AttractivenessWarning {
  storeId: string;
  storeName: string;
  field: string;
  message: string;
}

/**
 * Calculate attractiveness score for each store (0-100)
 * Missing values are interpolated with median from other stores.
 */
export function calculateAttractiveness(
  stores: Store[],
  weights: AttractivenessWeights = DEFAULT_WEIGHTS
): { stores: Store[]; warnings: AttractivenessWarning[] } {
  const warnings: AttractivenessWarning[] = [];

  if (stores.length === 0) return { stores: [], warnings };

  // Collect non-null values for median calculation
  const areas = stores.map((s) => s.areaSqm).filter((v): v is number => v !== null);
  const parkings = stores.map((s) => s.parkingSpaces).filter((v): v is number => v !== null);
  const reviewCounts = stores.map((s) => s.reviews).filter((v): v is number => v !== null);
  const ratings = stores.map((s) => s.rating).filter((v): v is number => v !== null);

  const medianArea = median(areas) ?? 50;
  const medianParking = median(parkings) ?? 10;
  const medianReviews = median(reviewCounts) ?? 50;
  const medianRating = median(ratings) ?? 3.5;

  const maxArea = Math.max(...areas, medianArea);
  const maxParking = Math.max(...parkings, medianParking);
  const maxReviews = Math.max(...reviewCounts, medianReviews);

  const updatedStores = stores.map((store) => {
    let area = store.areaSqm;
    let parking = store.parkingSpaces;
    let reviews = store.reviews;
    let rating = store.rating;

    if (area === null) {
      warnings.push({
        storeId: store.id,
        storeName: store.name,
        field: "areaSqm",
        message: `面積が未設定のため中央値(${medianArea})で補完`,
      });
      area = medianArea;
    }
    if (parking === null) {
      warnings.push({
        storeId: store.id,
        storeName: store.name,
        field: "parkingSpaces",
        message: `駐車場台数が未設定のため中央値(${medianParking})で補完`,
      });
      parking = medianParking;
    }
    if (reviews === null) {
      warnings.push({
        storeId: store.id,
        storeName: store.name,
        field: "reviews",
        message: `口コミ数が未設定のため中央値(${medianReviews})で補完`,
      });
      reviews = medianReviews;
    }
    if (rating === null) {
      warnings.push({
        storeId: store.id,
        storeName: store.name,
        field: "rating",
        message: `評価が未設定のため中央値(${medianRating})で補完`,
      });
      rating = medianRating;
    }

    // Normalize each factor to 0-1
    const normArea = maxArea > 0 ? area / maxArea : 0;
    const normParking = maxParking > 0 ? parking / maxParking : 0;
    const normReviews = maxReviews > 0 ? reviews / maxReviews : 0;
    const normRating = rating / 5;
    const normMainRoad = store.mainRoad === "yes" ? 1 : 0;
    const normHours = store.businessHours === "長" ? 1 : store.businessHours === "普" ? 0.6 : 0.3;

    const score =
      normArea * weights.areaSqm +
      normParking * weights.parkingSpaces +
      normReviews * weights.reviews +
      normRating * weights.rating +
      normMainRoad * weights.mainRoad +
      normHours * weights.businessHours;

    const attractiveness = Math.round(score * 100);

    return { ...store, attractiveness };
  });

  return { stores: updatedStores, warnings };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
