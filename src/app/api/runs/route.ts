import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema, reapStaleRuns } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    await reapStaleRuns(); // clôture les runs « running » sans réponse n8n (>45 min)
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const { rows } = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
      if (!rows.length) return NextResponse.json({ error: "introuvable" }, { status: 404 });
      return NextResponse.json(rows[0]);
    }
    const { rows } = await pool.query(
      `SELECT id, config_id, config_name, status, count, error, started_at, finished_at
       FROM runs ORDER BY started_at DESC LIMIT 50`
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureSchema();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
    const { rowCount } = await pool.query(`DELETE FROM runs WHERE id = $1`, [id]);
    if (!rowCount) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
