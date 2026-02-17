import { z } from "zod";

// ─── Population Mesh ───
export const PopulationCellSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  population: z.number(),
  meshCode: z.string(),
});
export type PopulationCell = z.infer<typeof PopulationCellSchema>;

export const PopulationMeshRequestSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  radiusKm: z.number().min(0.5).max(20),
});
export type PopulationMeshRequest = z.infer<typeof PopulationMeshRequestSchema>;

export const PopulationMeshResponseSchema = z.object({
  cells: z.array(PopulationCellSchema),
  summary: z.object({
    total: z.number(),
    average: z.number(),
    max: z.number(),
    cellCount: z.number(),
  }),
});
export type PopulationMeshResponse = z.infer<typeof PopulationMeshResponseSchema>;

// ─── Competitors ───
export const CompetitorSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number().nullable(),
  reviewCount: z.number(),
  address: z.string().optional(),
  googleMapsUrl: z.string().optional(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorRequestSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  radiusKm: z.number(),
  query: z.string(),
});
export type CompetitorRequest = z.infer<typeof CompetitorRequestSchema>;

// ─── Facility Types (internal) ───
export const FacilityTypeSchema = z.enum([
  "shopping_mall",
  "supermarket",
  "train_station",
  "hospital",
  "school",
  "city_hall",
]);
export type FacilityType = z.infer<typeof FacilityTypeSchema>;

export const FacilitySchema = z.object({
  placeId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  type: FacilityTypeSchema,
  category: z.enum(["集客施設", "交通・導線", "生活動線"]),
});
export type Facility = z.infer<typeof FacilitySchema>;

export const FacilityRequestSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  radiusKm: z.number(),
  types: z.array(FacilityTypeSchema).optional(),
});
export type FacilityRequest = z.infer<typeof FacilityRequestSchema>;

// ─── Store Registration ───
export const StoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  storeType: z.enum(["自社", "競合"]),
  areaSqm: z.number().min(0).nullable(),
  parkingSpaces: z.number().min(0).nullable(),
  mainRoad: z.enum(["yes", "no"]),
  visibility: z.enum(["高", "中", "低"]),
  businessHours: z.enum(["長", "普", "短"]),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  attractiveness: z.number().min(0).max(100).nullable(),
});
export type Store = z.infer<typeof StoreSchema>;

export const StoreCreateSchema = z.object({
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  storeType: z.enum(["自社", "競合"]),
  areaSqm: z.number().min(0).nullable(),
  parkingSpaces: z.number().min(0).nullable(),
  mainRoad: z.enum(["yes", "no"]),
  visibility: z.enum(["高", "中", "低"]),
  businessHours: z.enum(["長", "普", "短"]),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
});
export type StoreCreate = z.infer<typeof StoreCreateSchema>;

// ─── Attractiveness ───
export const AttractivenessWeightsSchema = z.object({
  areaSqm: z.number().default(0.35),
  parkingSpaces: z.number().default(0.25),
  reviews: z.number().default(0.20),
  rating: z.number().default(0.10),
  mainRoad: z.number().default(0.05),
  businessHours: z.number().default(0.05),
});
export type AttractivenessWeights = z.infer<typeof AttractivenessWeightsSchema>;

// ─── Huff Model ───
export const HuffRequestSchema = z.object({
  cells: z.array(PopulationCellSchema),
  stores: z.array(StoreSchema),
  targetStoreId: z.string(),
  alpha: z.number().min(0.1).max(5).default(1),
  beta: z.number().min(0.1).max(5).default(2),
});
export type HuffRequest = z.infer<typeof HuffRequestSchema>;

export const HuffCellResultSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  population: z.number(),
  probability: z.number(),
  capturedPopulation: z.number(),
});
export type HuffCellResult = z.infer<typeof HuffCellResultSchema>;

export const HuffResponseSchema = z.object({
  results: z.array(HuffCellResultSchema),
  totalCaptured: z.number(),
  averageProbability: z.number(),
});
export type HuffResponse = z.infer<typeof HuffResponseSchema>;

// ─── AI Analysis ───
export const AIAnalysisRequestSchema = z.object({
  areaName: z.string(),
  populationSummary: z.object({
    total: z.number(),
    average: z.number(),
    max: z.number(),
  }).nullable(),
  competitorCount: z.number(),
  facilityDensity: z.number(),
  stores: z.array(StoreSchema),
  huffResult: HuffResponseSchema.nullable(),
});
export type AIAnalysisRequest = z.infer<typeof AIAnalysisRequestSchema>;

export const AIRecommendedPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  reason: z.string(),
});
export type AIRecommendedPoint = z.infer<typeof AIRecommendedPointSchema>;

export const AIAnalysisResponseSchema = z.object({
  signageSuitability: z.string(),
  openingSuitability: z.string(),
  tradeAreaRisk: z.string(),
  recommendedActions: z.array(z.string()),
  recommendedPoints: z.array(AIRecommendedPointSchema),
  summary: z.string(),
});
export type AIAnalysisResponse = z.infer<typeof AIAnalysisResponseSchema>;

// ─── Ranking ───
export const RankingItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  population: z.number(),
  rank: z.number(),
});
export type RankingItem = z.infer<typeof RankingItemSchema>;

// ─── Population Change ───
export const PopulationChangeItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  populationOld: z.number(),
  populationNew: z.number(),
  change: z.number(),
  changeRate: z.number(),
});
export type PopulationChangeItem = z.infer<typeof PopulationChangeItemSchema>;

// ─── Day-Night Population ───
export const DayNightItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  dayPopulation: z.number().nullable(),
  nightPopulation: z.number().nullable(),
  ratio: z.number().nullable(),
});
export type DayNightItem = z.infer<typeof DayNightItemSchema>;

// ─── Layer Toggle ───
export type LayerName =
  | "人口"
  | "競合店舗"
  | "集客施設"
  | "交通・導線"
  | "生活動線"
  | "登録店舗"
  | "交通量（推定）";

// ─── App State ───
export interface AnalysisState {
  areaName: string;
  center: { lat: number; lng: number } | null;
  radiusKm: number;
  competitorQuery: string;
  layers: Record<LayerName, boolean>;
  activeTab: "map" | "rankings" | "changes" | "day-night" | "huff";
}

// ─── Traffic Estimate ───
export const TrafficEstimateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  score: z.number(),
  label: z.string(),
});
export type TrafficEstimate = z.infer<typeof TrafficEstimateSchema>;
