import { NextRequest, NextResponse } from "next/server";
import { buildGoogleInstallUrl } from "@/lib/google";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildGoogleInstallUrl(state, redirectUri);
  // Allow caller to specify where they want to land back at after auth —
  // /signup uses ?return=/signup so the wizard can resume on the next step.
  const ret = new URL(req.url).searchParams.get("return") ?? "/dashboard";
  const safeReturn = ret.startsWith("/") ? ret : "/dashboard";
  const res = NextResponse.redirect(url);
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/",
  };
  res.cookies.set("google_oauth_state", state, cookieOpts);
  res.cookies.set("oauth_return", safeReturn, cookieOpts);
  return res;
}
