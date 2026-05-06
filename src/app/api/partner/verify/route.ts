import { NextRequest, NextResponse } from "next/server";

const VALID_CODES = ["iwantdonkey"];

// POST /api/partner/verify { code }
// Returns 200 + sets the partner_verified cookie on success, 401 on failure.
// Cookie is server-set so it's reliably visible to middleware on the next
// navigation (client-side document.cookie writes can be flaky across redirects).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code ?? "").trim().toLowerCase();
  if (!VALID_CODES.includes(code)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, code });
  const isHttps = req.nextUrl.protocol === "https:";
  res.cookies.set("partner_verified", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax",
    secure: isHttps,
  });
  res.cookies.set("partner_code", code, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: isHttps,
  });
  return res;
}
