import { NextResponse } from "next/server";
import { getZoneTree } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/zones — arbre des zones pour le ZonePicker. { zones: ZoneTree[] }
 *  Données quasi statiques (ne changent qu'au re-seed admin) → on met en cache
 *  agressivement (navigateur + edge) pour ne pas re-payer la requête à chaque
 *  ouverture du formulaire. */
export async function GET() {
  try {
    const zones = await getZoneTree();
    return NextResponse.json(
      { zones },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (err) {
    console.error("[GET /api/zones] failed", err);
    return NextResponse.json({ error: "Failed to load zones" }, { status: 500 });
  }
}
