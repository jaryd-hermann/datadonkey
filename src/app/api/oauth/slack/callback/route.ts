import { NextRequest, NextResponse } from "next/server";
import { exchangeSlackCode } from "@/lib/slack";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("slack_oauth_state")?.value;
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/dashboard?slack=error", url.origin));
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
    return NextResponse.redirect(new URL("/dashboard?slack=ok#slack", url.origin));
  } catch (err) {
    console.error("[slack callback]", err);
    return NextResponse.redirect(new URL("/dashboard?slack=error#slack", url.origin));
  }
}
