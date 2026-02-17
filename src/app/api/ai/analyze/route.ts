import { NextRequest, NextResponse } from "next/server";
import { AIAnalysisRequestSchema } from "@/types";
import OpenAI from "openai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AIAnalysisRequestSchema.parse(body);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const storesSummary = parsed.stores
      .map(
        (s) =>
          `- ${s.name}（${s.storeType}）魅力度:${s.attractiveness ?? "未算出"} 面積:${s.areaSqm ?? "不明"}㎡ 駐車場:${s.parkingSpaces ?? "不明"}台`
      )
      .join("\n");

    const huffSummary = parsed.huffResult
      ? `ハフモデル結果: 吸引人口=${parsed.huffResult.totalCaptured}人, 平均確率=${parsed.huffResult.averageProbability}`
      : "ハフモデル: 未実行";

    const prompt = `あなたは商圏分析の専門家です。以下のデータを基に、買取店舗の出店・看板設置の観点から分析してください。

## エリア情報
- エリア名: ${parsed.areaName}
- 人口: ${parsed.populationSummary ? `合計${parsed.populationSummary.total}人 / 平均${parsed.populationSummary.average}人 / 最大${parsed.populationSummary.max}人` : "未取得"}
- 競合店舗数: ${parsed.competitorCount}件
- 施設密度: ${parsed.facilityDensity}

## 登録店舗
${storesSummary || "なし"}

## ハフモデル
${huffSummary}

以下のJSON形式で回答してください（日本語）：
{
  "signageSuitability": "看板設置の適性についての分析（2-3文）",
  "openingSuitability": "出店適性についての分析（2-3文）",
  "tradeAreaRisk": "商圏リスクについての分析（2-3文）",
  "recommendedActions": ["推奨アクション1", "推奨アクション2", "推奨アクション3"],
  "recommendedPoints": [{"lat": 数値, "lng": 数値, "reason": "推奨理由"}],
  "summary": "総合評価（3-4文）"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 502 }
      );
    }

    const result = JSON.parse(content);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
