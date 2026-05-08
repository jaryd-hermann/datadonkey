import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, getGoogleUserEmail } from "@/lib/google";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  const returnTo = req.cookies.get("oauth_return")?.value;
  // Honor the return cookie set at /api/oauth/google/start. Fall back to
  // /dashboard so legacy starts (no cookie) still work.
  const base = returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard";
  const successUrl = base.startsWith("/signup")
    ? new URL(`${base}?google=ok`, url.origin)
    : new URL(`${base}?google=ok#calendar`, url.origin);
  const errorUrl = base.startsWith("/signup")
    ? new URL(`${base}?google=error`, url.origin)
    : new URL(`${base}?google=error#calendar`, url.origin);

  const userId = await getCurrentUserId();
  if (!userId) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL(`${base}?google=unauthorized`, url.origin)),
    );
  }
  if (!code || !state || state !== cookieState) {
    return clearOAuthCookies(NextResponse.redirect(errorUrl));
  }
  const origin = process.env.APP_URL ?? url.origin;
  const redirectUri = `${origin}/api/oauth/google/callback`;

  try {
    const tok = await exchangeGoogleCode(code, redirectUri);
    const email = await getGoogleUserEmail(tok.access_token);
    const expiry = new Date(Date.now() + tok.expires_in * 1000);
    await prisma.connection.upsert({
      where: { userId },
      create: {
        userId,
        calendarConnected: true,
        calendarProvider: "google",
        googleAccessToken: tok.access_token,
        googleRefreshToken: tok.refresh_token ?? undefined,
        googleTokenExpiry: expiry,
        googleEmail: email,
      },
      update: {
        calendarConnected: true,
        calendarProvider: "google",
        googleAccessToken: tok.access_token,
        // Keep existing refresh_token if Google doesn't return one (it skips
        // the refresh_token after the first consent).
        ...(tok.refresh_token ? { googleRefreshToken: tok.refresh_token } : {}),
        googleTokenExpiry: expiry,
        googleEmail: email,
      },
    });
    return clearOAuthCookies(NextResponse.redirect(successUrl));
  } catch (err) {
    console.error("[google callback]", err);
    return clearOAuthCookies(NextResponse.redirect(errorUrl));
  }
}

function clearOAuthCookies(res: NextResponse) {
  res.cookies.delete("google_oauth_state");
  res.cookies.delete("oauth_return");
  return res;
}
