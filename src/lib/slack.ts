import { WebClient } from "@slack/web-api";

const SCOPES = ["chat:write", "im:write", "users:read", "users:read.email"];

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
