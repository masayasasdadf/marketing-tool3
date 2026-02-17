# 商圏分析ツール（買取ラクダ）

買取ラクダ向けの商圏分析UIツール。地図上で商圏を分析し、人口・競合・集客施設・登録店舗・ハフモデル・AI解説を確認できる。

## 技術スタック

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Leaflet + OpenStreetMap** (SSR無効、dynamic import)
- **Zod** (API入出力バリデーション)

## 外部API

| API | 用途 |
|-----|------|
| OpenAI GPT API | AI分析（出店適性・看板適性・リスク評価） |
| e-Stat API | 人口メッシュ、ランキング、人口増減、昼夜間人口 |
| Google Places API | 競合店舗検索、集客施設・交通・生活動線検索 |

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数設定

`.env.local` を作成：

```env
OPENAI_API_KEY=sk-xxxx
GOOGLE_MAPS_API_KEY=AIzaxxxxxxxx
ESTAT_APP_ID=xxxxxxxxxxxx
KV_REST_API_URL=https://xxxx.upstash.io
KV_REST_API_TOKEN=xxxx
NEXT_PUBLIC_APP_NAME=商圏分析ツール
```

| 変数 | 説明 | 取得方法 |
|------|------|----------|
| `OPENAI_API_KEY` | OpenAI APIキー | https://platform.openai.com/ |
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform APIキー（Places API有効化） | https://console.cloud.google.com/ |
| `ESTAT_APP_ID` | e-Stat アプリケーションID | https://www.e-stat.go.jp/api/ |
| `KV_REST_API_URL` | Vercel KV (Upstash Redis) URL | Vercelダッシュボード → Storage |
| `KV_REST_API_TOKEN` | Vercel KV トークン | 同上 |
| `NEXT_PUBLIC_APP_NAME` | アプリ表示名 | 任意 |

### 3. 開発サーバー起動

```bash
npm run dev
```

http://localhost:3000 でアクセス。

### 4. ビルド

```bash
npm run build
npm start
```

## Vercelデプロイ

1. GitHubリポジトリをVercelにインポート
2. Settings → Environment Variables で上記の環境変数を設定
3. Storage → KV Database を作成（自動で`KV_REST_API_URL`と`KV_REST_API_TOKEN`が設定される）
4. デプロイ実行

## 機能一覧

### Mapタブ
- **地図表示**: OpenStreetMap + Leaflet（クリックで中心点設定）
- **人口メッシュ**: e-Stat 500mメッシュ人口のヒート表示
- **競合店舗**: Google Places検索、評価・口コミ表示、Google Mapsリンク
- **集客施設**: ショッピングモール、スーパー
- **交通・導線**: 駅
- **生活動線**: 病院、学校、市役所
- **店舗登録**: 自社/競合店舗を登録（Vercel KVで永続化）
- **交通量（推定）**: 施設密度ベースの推定値（実測データではない）
- **AI分析**: GPTによる看板適性・出店適性・リスク・推奨アクション

### Rankingsタブ
- 市区町村別人口ランキング（e-Stat）

### Changesタブ
- 人口増減比較（年度間）

### Day-Nightタブ
- 昼夜間人口比較（取得できない場合は未対応表示、データ捏造なし）

### Huffタブ
- ハフモデル分析
- 対象店舗選択、α/βパラメータ調整
- 魅力度内訳表示
- 地図ヒート表示

## API仕様

### POST `/api/estat/population_mesh`
人口メッシュデータ取得。
```json
{ "lat": 35.68, "lng": 139.76, "radiusKm": 3 }
```

### POST `/api/places/competitors`
競合店舗検索。
```json
{ "lat": 35.68, "lng": 139.76, "radiusKm": 3, "query": "買取" }
```

### POST `/api/places/poi`
施設検索（集客施設・交通・生活動線）。
```json
{ "lat": 35.68, "lng": 139.76, "radiusKm": 3 }
```

### GET `/api/estat/ranking?prefCode=13&limit=50`
市区町村人口ランキング。

### GET `/api/estat/change?prefCode=13`
人口増減データ。

### GET `/api/estat/daynight?prefCode=13`
昼夜間人口データ。

### GET/POST/DELETE `/api/stores`
店舗CRUD（Vercel KV永続化）。

### POST `/api/model/huff`
ハフモデル計算。
```json
{
  "cells": [...],
  "stores": [...],
  "targetStoreId": "store_xxx",
  "alpha": 1,
  "beta": 2
}
```

### POST `/api/ai/analyze`
AI分析実行。
```json
{
  "areaName": "渋谷",
  "populationSummary": { "total": 50000, "average": 200, "max": 800 },
  "competitorCount": 12,
  "facilityDensity": 45,
  "stores": [...],
  "huffResult": null
}
```

## 魅力度算出ロジック

各店舗のスコア（0〜100）を以下の重みで算出：

| 項目 | 重み |
|------|------|
| 面積㎡ | 35% |
| 駐車場台数 | 25% |
| 口コミ数 | 20% |
| 評価 | 10% |
| 幹線道路沿い | 5% |
| 営業時間 | 5% |

欠損値は全店舗の中央値で補完。補完時は警告を表示。

## ディレクトリ構成

```
src/
├── app/
│   ├── api/
│   │   ├── ai/analyze/route.ts
│   │   ├── estat/
│   │   │   ├── population_mesh/route.ts
│   │   │   ├── ranking/route.ts
│   │   │   ├── change/route.ts
│   │   │   └── daynight/route.ts
│   │   ├── model/huff/route.ts
│   │   ├── places/
│   │   │   ├── competitors/route.ts
│   │   │   └── poi/route.ts
│   │   └── stores/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── AIPanel.tsx
│   ├── ChangesTab.tsx
│   ├── DayNightTab.tsx
│   ├── DynamicMap.tsx
│   ├── HuffTab.tsx
│   ├── MapView.tsx
│   ├── RankingsTab.tsx
│   ├── Sidebar.tsx
│   ├── StorePanel.tsx
│   └── TabBar.tsx
├── lib/
│   ├── attractiveness.ts
│   ├── geo.ts
│   ├── huff.ts
│   └── traffic-estimate.ts
└── types/
    └── index.ts
```

## 注意事項

- 交通量は**推定値**です（施設密度ベース）。実測データではありません。
- 昼夜間人口はe-Statから取得可能な場合のみ表示します。データの捏造は行いません。
- すべての外部API呼び出しはRoute Handler経由で行います（フロントから直接呼び出しません）。
- APIキーは環境変数で管理し、コードに直書きしていません。
