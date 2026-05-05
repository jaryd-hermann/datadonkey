import { WebClient } from "@slack/web-api";
import crypto from "crypto";

const SCOPES = [
  "chat:write",
  "im:write",
  "users:read",
  "users:read.email",
  "app_mentions:read",
  "im:history",
  "im:read",
];

export function buildSlackInstallUrl(state: string, redirectUri: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("SLACK_CLIENT_ID missing");
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackOAuthExchange {
  bot_token: string;
  team_id: string;
  team_name: string;
  bot_user_id: string;
  authed_user_id: string;
}

export async function exchangeSlackCode(code: string, redirectUri: string): Promise<SlackOAuthExchange> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Slack creds missing");
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const r = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!j.ok) throw new Error(`Slack OAuth failed: ${JSON.stringify(j)}`);
  return {
    bot_token: String(j.access_token),
    team_id: String((j.team as { id: string } | undefined)?.id ?? ""),
    team_name: String((j.team as { name: string } | undefined)?.name ?? ""),
    bot_user_id: String(j.bot_user_id ?? ""),
    authed_user_id: String((j.authed_user as { id: string } | undefined)?.id ?? ""),
  };
}

export async function dmUserByEmail(args: {
  botToken: string;
  email: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const c = new WebClient(args.botToken);
    const lookup = await c.users.lookupByEmail({ email: args.email });
    const userId = lookup.user?.id;
    if (!userId) return { sent: false, reason: "user_not_found" };
    const conv = await c.conversations.open({ users: userId });
    const channel = conv.channel?.id;
    if (!channel) return { sent: false, reason: "could_not_open_dm" };
    await c.chat.postMessage({
      channel,
      text: args.text,
      ...(args.blocks ? { blocks: args.blocks as never } : {}),
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[slack] DM failed:", msg);
    return { sent: false, reason: msg };
  }
}

// Verify Slack request signature per
// https://api.slack.com/authentication/verifying-requests-from-slack
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  // Reject stale (>5 min) requests to thwart replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  // timingSafeEqual requires equal-length buffers
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function postSlackMessage(args: {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<{ ok: boolean; ts?: string; reason?: string }> {
  try {
    const c = new WebClient(args.botToken);
    const r = await c.chat.postMessage({
      channel: args.channel,
      text: args.text,
      thread_ts: args.threadTs,
    });
    return { ok: !!r.ok, ts: r.ts ?? undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[slack] postMessage failed:", msg);
    return { ok: false, reason: msg };
  }
}

export async function dmAuthedUser(args: {
  botToken: string;
  authedUserId: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const c = new WebClient(args.botToken);
    const conv = await c.conversations.open({ users: args.authedUserId });
    const channel = conv.channel?.id;
    if (!channel) return { sent: false, reason: "could_not_open_dm" };
    await c.chat.postMessage({ channel, text: args.text });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, reason: msg };
  }
}
