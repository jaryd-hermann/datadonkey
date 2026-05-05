import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "DataDonkey <onboarding@resend.dev>";
const audienceId = process.env.RESEND_AUDIENCE_ID;

let client: Resend | null = null;
function getClient() {
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

export interface SendArgs {
  to: string;
  subject: string;
  markdown: string;
}

// Markdown -> very simple HTML. Good enough for our templates.
function mdToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let html = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" style="color:#ea580c;text-decoration:none;">$1</a>',
  );
  html = html.replace(
    /(^|[^"])(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2" style="color:#ea580c;text-decoration:none;">$2</a>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|\n)[-•]\s+(.+)/g, "$1<li>$2</li>");
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  html = html.replace(/(^|\n)###\s+(.+)/g, "$1<h3>$2</h3>");
  html = html
    .split(/\n{2,}/)
    .map((p) => (p.trim().startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`))
    .join("\n");
  return html;
}

function wrapHtml(body: string) {
  return `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;line-height:1.5;color:#111;padding:8px 0;">${body}</div>`;
}

export async function sendFollowupEmail(args: SendArgs) {
  const c = getClient();
  if (!c) {
    console.warn("[email] RESEND_API_KEY missing, skipping send");
    return { sent: false, reason: "no_api_key" };
  }
  const html = wrapHtml(mdToHtml(args.markdown));
  const res = await c.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html,
    text: args.markdown,
  });
  if (res.error) {
    console.error("[email] resend error:", res.error);
    return { sent: false, reason: res.error.message };
  }
  return { sent: true, id: res.data?.id };
}

// ---- lifecycle templates ----

export async function sendWelcomeEmail(args: { to: string; name: string }) {
  const c = getClient();
  if (!c) return { sent: false, reason: "no_api_key" };
  const subject = "Welcome to DataDonkey 🫏";
  const md = `Hi ${args.name.split(" ")[0] || "there"},

Welcome to DataDonkey — your data analyst on every call.

**What happens next:**

- Invite DataDonkey to a meeting (paste any Meet, Teams, or Zoom link in your dashboard)
- DataDonkey listens, then sends you a private follow-up with the data questions that came up — answered with real numbers
- Your data stays in your tool; we're just the carrier

**Try this first:** drop a meeting link into [your dashboard](https://datadonkey.ai/dashboard). The next call you have, DataDonkey will follow up with what mattered.

Hit reply with anything — I read every email.

— Jaryd
DataDonkey`;
  const res = await c.emails.send({
    from,
    to: args.to,
    subject,
    html: wrapHtml(mdToHtml(md)),
    text: md,
  });
  if (res.error) {
    console.error("[email] welcome failed:", res.error);
    return { sent: false, reason: res.error.message };
  }
  return { sent: true, id: res.data?.id };
}

export async function sendFirstCallEmail(args: {
  to: string;
  name: string;
  meetingUrl: string;
}) {
  const c = getClient();
  if (!c) return { sent: false, reason: "no_api_key" };
  const subject = "DataDonkey just joined its first call 🎉";
  const md = `Nice — DataDonkey is in your call.

**What's happening on our end:**

- Listening (transcribing) so we can spot data questions
- After you hang up, we'll send you the follow-up: a private briefing of what data was raised, with answers from your tool
- We'll also DM the same in Slack if you connected it

If anything feels off after the call, hit reply and tell me — this is build-in-public, your feedback shapes the product.

— Jaryd
DataDonkey`;
  const res = await c.emails.send({
    from,
    to: args.to,
    subject,
    html: wrapHtml(mdToHtml(md)),
    text: md,
  });
  if (res.error) {
    console.error("[email] first-call failed:", res.error);
    return { sent: false, reason: res.error.message };
  }
  return { sent: true, id: res.data?.id };
}

// ---- Resend audience ----

export async function addToResendAudience(args: { email: string; name: string }) {
  const c = getClient();
  if (!c) return { added: false, reason: "no_api_key" };
  if (!audienceId) {
    console.warn("[email] RESEND_AUDIENCE_ID missing, skipping audience add");
    return { added: false, reason: "no_audience_id" };
  }
  try {
    const [first, ...rest] = (args.name || "").split(/\s+/);
    const res = await c.contacts.create({
      audienceId,
      email: args.email,
      firstName: first || undefined,
      lastName: rest.join(" ") || undefined,
      unsubscribed: false,
    });
    if (res.error) {
      // Resend treats duplicates as 422 — ignore those.
      const msg = res.error.message || "";
      if (/already exists/i.test(msg)) return { added: true, dup: true };
      console.error("[email] audience add failed:", res.error);
      return { added: false, reason: msg };
    }
    return { added: true, id: res.data?.id };
  } catch (err) {
    console.error("[email] audience add threw:", err);
    return { added: false, reason: String(err) };
  }
}
