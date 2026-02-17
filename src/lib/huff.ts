import { haversineDistance } from "./geo";
import type { PopulationCell, Store, HuffCellResult } from "@/types";

/**
 * Huff model: Pij = (Aj^alpha / dij^beta) / Σ(Ak^alpha / dik^beta)
 */
export function calculateHuff(
  cells: PopulationCell[],
  stores: Store[],
  targetStoreId: string,
  alpha: number = 1,
  beta: number = 2
): { results: HuffCellResult[]; totalCaptured: number; averageProbability: number } {
  const storesWithAttractiveness = stores.filter(
    (s) => s.attractiveness !== null && s.attractiveness > 0
  );

  if (storesWithAttractiveness.length === 0) {
    return { results: [], totalCaptured: 0, averageProbability: 0 };
  }

  const targetIndex = storesWithAttractiveness.findIndex(
    (s) => s.id === targetStoreId
  );
  if (targetIndex === -1) {
    return { results: [], totalCaptured: 0, averageProbability: 0 };
  }

  const results: HuffCellResult[] = [];
  let totalCaptured = 0;
  let totalProbability = 0;

  for (const cell of cells) {
    // Calculate utility for each store
    const utilities = storesWithAttractiveness.map((store) => {
      const d = haversineDistance(cell.lat, cell.lng, store.lat, store.lng);
      const dist = Math.max(d, 0.1); // Avoid division by zero
      const A = store.attractiveness!;
      return Math.pow(A, alpha) / Math.pow(dist, beta);
    });

    const totalUtility = utilities.reduce((sum, u) => sum + u, 0);

    const probability = totalUtility > 0 ? utilities[targetIndex] / totalUtility : 0;
    const capturedPopulation = cell.population * probability;

    totalCaptured += capturedPopulation;
    totalProbability += probability;

    results.push({
      lat: cell.lat,
      lng: cell.lng,
      population: cell.population,
      probability,
      capturedPopulation,
    });
  }

  const averageProbability =
    results.length > 0 ? totalProbability / results.length : 0;

  return {
    results,
    totalCaptured: Math.round(totalCaptured),
    averageProbability: Math.round(averageProbability * 1000) / 1000,
  };
}
