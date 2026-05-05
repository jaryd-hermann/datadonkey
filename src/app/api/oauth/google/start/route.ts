import { NextRequest, NextResponse } from "next/server";
import { buildGoogleInstallUrl } from "@/lib/google";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildGoogleInstallUrl(state, redirectUri);
  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
