import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { fetchActesVille, fetchActesAllCommunes, debugObservatoire } from "@/lib/observatoire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/fetch-observatoire { secret }
 * Récupère le dataset Observatoire (data.public.lu) : prix signé ville + par
 * commune. À appeler manuellement (ou périodiquement). Idempotent.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const expected = process.env.INGEST_SECRET || "";
    if (expected && body?.secret !== expected) {
      return NextResponse.json({ error: "secret invalide" }, { status: 401 });
    }
    if (req.nextUrl.searchParams.get("debug")) {
      return NextResponse.json(await debugObservatoire());
    }
    const [ville, communes] = await Promise.all([fetchActesVille(), fetchActesAllCommunes()]);
    return NextResponse.json({ ok: true, ville, communes });
  } catch (e: any) {
    console.error("[fetch-observatoire]", e);
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
