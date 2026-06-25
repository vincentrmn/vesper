import { NextRequest, NextResponse } from "next/server";
import { triggerRun, resolveBase } from "@/lib/trigger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { configId } = await req.json().catch(() => ({}));
  if (!configId) return NextResponse.json({ error: "configId requis" }, { status: 400 });

  const result = await triggerRun(configId, { base: resolveBase(req) });
  if (result.ok) return NextResponse.json({ runId: result.runId });
  return NextResponse.json(
    result.runId ? { error: result.error, runId: result.runId } : { error: result.error },
    { status: result.status }
  );
}
