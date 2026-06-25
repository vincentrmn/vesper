import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getCommuneSigned, getDecote } from "@/lib/observatoire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/observatoire?commune=<slug>
 * Renvoie le prix SIGNÉ (notarial) de la commune + la décote affiché→signé globale.
 * Sert la « lecture marché » de la page run.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const slug = req.nextUrl.searchParams.get("commune") || "";
    const [signed, decote] = await Promise.all([
      slug ? getCommuneSigned(slug) : Promise.resolve(null),
      getDecote(),
    ]);
    return NextResponse.json({ commune: slug || null, signed, decote });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
