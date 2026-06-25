import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, name, criteria, created_at, updated_at
       FROM configs ORDER BY updated_at DESC`
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    if (!body || !body.name || !body.criteria) {
      return NextResponse.json({ error: "name, criteria requis" }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO configs (name, criteria) VALUES ($1, $2) RETURNING id`,
      [body.name, body.criteria]
    );
    return NextResponse.json({ id: rows[0].id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
