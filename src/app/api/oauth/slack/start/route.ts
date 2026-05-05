import { NextRequest, NextResponse } from "next/server";
import { buildSlackInstallUrl } from "@/lib/slack";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/slack/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildSlackInstallUrl(state, redirectUri);
  const res = NextResponse.redirect(url);
  res.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
