import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT * FROM configs WHERE id = $1`, [params.id]);
  if (!rows.length) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  await pool.query(`DELETE FROM configs WHERE id = $1`, [params.id]);
  return NextResponse.json({ ok: true });
}
