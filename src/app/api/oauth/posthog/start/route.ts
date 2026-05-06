import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  generatePKCE,
  generateState,
  type PosthogRegion,
} from "@/lib/posthog-oauth";

// GET /api/oauth/posthog/start?return=/signup&region=us
// Generates PKCE + state, sets HTTP-only cookies keyed to the state, and
// redirects the browser to PostHog's /oauth/authorize. The callback route
// reads the same cookies to verify state + exchange the code.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ret = url.searchParams.get("return") ?? "/onboarding/connect";
  const region = (url.searchParams.get("region") ?? "us") as PosthogRegion;
  const safeReturn = ret.startsWith("/") ? ret : "/onboarding/connect";

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl({ codeChallenge, state });

  const isHttps = url.protocol === "https:";
  const res = NextResponse.redirect(authorizeUrl);
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps,
    maxAge: 600, // 10 min — plenty for the OAuth round-trip
    path: "/",
  };
  res.cookies.set("ph_oauth_state", state, cookieOpts);
  res.cookies.set("ph_oauth_verifier", codeVerifier, cookieOpts);
  res.cookies.set("ph_oauth_region", region, cookieOpts);
  res.cookies.set("ph_oauth_return", safeReturn, cookieOpts);
  return res;
}
