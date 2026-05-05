import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "DataDonkey <onboarding@resend.dev>";

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

// Markdown -> very simple HTML. Good enough for an email follow-up.
function mdToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // links
  let html = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  // bare urls
  html = html.replace(
    /(^|[^"])(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2">$2</a>',
  );
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // bullets
  html = html.replace(/(^|\n)[-•]\s+(.+)/g, "$1<li>$2</li>");
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  // ### headings
  html = html.replace(/(^|\n)###\s+(.+)/g, "$1<h3>$2</h3>");
  // paragraphs from blank lines
  html = html
    .split(/\n{2,}/)
    .map((p) => (p.trim().startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`))
    .join("\n");
  return html;
}

export async function sendFollowupEmail(args: SendArgs) {
  const c = getClient();
  if (!c) {
    console.warn("[email] RESEND_API_KEY missing, skipping send");
    return { sent: false, reason: "no_api_key" };
  }
  const html = `<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; line-height: 1.5; color: #111;">${mdToHtml(args.markdown)}</div>`;
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
