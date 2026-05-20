import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { requestBusinessInsights } from "@/lib/python-api";
import { getAiSettings, getDashboardStats } from "@/lib/repository";
import { t } from "@/lang";

export const runtime = "nodejs";

const FALLBACK_INSIGHTS = [...t.stats.fallbackInsights];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);

    const stats = await getDashboardStats();
    const ai = await getAiSettings();

    const insightPayload = {
      gesamt_anzahl: stats.totals.gesamt_anzahl,
      gesamt_summe_eur: Number(stats.totals.gesamt_summe.toFixed(2)),
      avg_rechnung_eur: Number(stats.totals.avg_betrag.toFixed(2)),
      eingang_summe_eur: Number(stats.totals.eingang_summe.toFixed(2)),
      ausgang_summe_eur: Number(stats.totals.ausgang_summe.toFixed(2)),
      netto_cashflow_eur: Number(stats.totals.netto_cashflow.toFixed(2)),
      top_zeitraum: stats.top.zeitraum,
      top_kategorie: stats.top.kategorie,
      top_lieferant: stats.top.lieferant,
      trend_30_tage_prozent: Number(stats.trend30.toFixed(2))
    };

    const insights = await requestBusinessInsights(insightPayload, ai);

    return NextResponse.json({
      ok: true,
      stats,
      insights: insights.length > 0 ? insights : FALLBACK_INSIGHTS,
      insightSource: insights.length > 0 ? "ki" : "fallback"
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.statsLoadFailed }, { status: 500 });
  }
}
