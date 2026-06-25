import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy d'images (même origine) pour intégrer les photos atHome/Immotop dans les
// exports PDF (sinon bloquées par CORS côté navigateur). Hosts whitelistés.
const ALLOWED = [
  /(^|\.)static\.athome\.eu$/i,
  /(^|\.)pic\.immotop\.lu$/i,
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("url requis", { status: 400 });
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return new NextResponse("url invalide", { status: 400 });
  }
  if (u.protocol !== "https:" || !ALLOWED.some((re) => re.test(u.hostname))) {
    return new NextResponse("host non autorisé", { status: 403 });
  }
  try {
    const r = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    if (!r.ok) return new NextResponse(`amont ${r.status}`, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("erreur proxy", { status: 502 });
  }
}
