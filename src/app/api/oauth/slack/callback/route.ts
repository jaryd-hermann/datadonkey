import { NextRequest, NextResponse } from "next/server";
import { exchangeSlackCode } from "@/lib/slack";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("slack_oauth_state")?.value;
  const returnTo = req.cookies.get("oauth_return")?.value;
  const base = returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard";
  const successUrl = base.startsWith("/signup")
    ? new URL(`${base}?slack=ok`, url.origin)
    : new URL(`${base}?slack=ok#slack`, url.origin);
  const errorUrl = base.startsWith("/signup")
    ? new URL(`${base}?slack=error`, url.origin)
    : new URL(`${base}?slack=error#slack`, url.origin);

  if (!code || !state || state !== cookieState) {
    return clearOAuthCookies(NextResponse.redirect(errorUrl));
  }
  const origin = process.env.APP_URL ?? url.origin;
  const redirectUri = `${origin}/api/oauth/slack/callback`;

  try {
    const tok = await exchangeSlackCode(code, redirectUri);
    await prisma.connection.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        slackConnected: true,
        slackTeamId: tok.team_id,
        slackTeamName: tok.team_name,
        slackBotToken: tok.bot_token,
        slackUserId: tok.authed_user_id,
        slackBotUserId: tok.bot_user_id,
      },
      update: {
        slackConnected: true,
        slackTeamId: tok.team_id,
        slackTeamName: tok.team_name,
        slackBotToken: tok.bot_token,
        slackUserId: tok.authed_user_id,
        slackBotUserId: tok.bot_user_id,
      },
    });
    return clearOAuthCookies(NextResponse.redirect(successUrl));
  } catch (err) {
    console.error("[slack callback]", err);
    return clearOAuthCookies(NextResponse.redirect(errorUrl));
  }
}

function clearOAuthCookies(res: NextResponse) {
  res.cookies.delete("slack_oauth_state");
  res.cookies.delete("oauth_return");
  return res;
}
