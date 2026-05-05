import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, getGoogleUserEmail } from "@/lib/google";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/dashboard?google=error#calendar", url.origin));
  }
  const origin = process.env.APP_URL ?? url.origin;
  const redirectUri = `${origin}/api/oauth/google/callback`;

  try {
    const tok = await exchangeGoogleCode(code, redirectUri);
    const email = await getGoogleUserEmail(tok.access_token);
    const expiry = new Date(Date.now() + tok.expires_in * 1000);
    await prisma.connection.upsert({
      where: { id: "default" },
      create: {
        id: "default",
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
    return NextResponse.redirect(new URL("/dashboard?google=ok#calendar", url.origin));
  } catch (err) {
    console.error("[google callback]", err);
    return NextResponse.redirect(new URL("/dashboard?google=error#calendar", url.origin));
  }
}
