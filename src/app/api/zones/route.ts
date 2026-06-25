import { NextResponse } from "next/server";
import { getZoneTree } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/zones — arbre des zones pour le ZonePicker. { zones: ZoneTree[] } */
export async function GET() {
  try {
    const zones = await getZoneTree();
    return NextResponse.json({ zones });
  } catch (err) {
    console.error("[GET /api/zones] failed", err);
    return NextResponse.json({ error: "Failed to load zones" }, { status: 500 });
  }
}
