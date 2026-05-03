import Anthropic from "@anthropic-ai/sdk";
import type { Credentials } from "./connection";
import type { ProviderConfig } from "./providers";

// Bypass any local proxy (e.g. PostHog Code's ANTHROPIC_BASE_URL) so we can
// reach api.anthropic.com directly. The MCP server is only supported by the
// upstream API, not the proxy.
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  authToken: null,
  baseURL: "https://api.anthropic.com",
});

// PostHog's MCP returns ~206k tokens of tool definitions if you don't filter,
// which blows the model context window. We scope to a read-only subset via
// the ?tools= query param at the MCP URL level.
const POSTHOG_ALLOWED_TOOLS = [
  "query-trends",
  "query-funnel",
  "query-retention",
  "query-lifecycle",
  "query-stickiness",
  "query-paths",
  "execute-sql",
  "insights-list",
  "insight-get",
  "dashboard-get",
  "dashboards-get-all",
  "feature-flag-get-all",
  "experiment-get-all",
  "experiment-results-get",
  "query-error-tracking-issues",
  "query-session-recordings-list",
  "actions-get-all",
  "cohorts-list",
  "docs-search",
];

function buildMcpServerConfig(provider: ProviderConfig, credentials: Credentials) {
  if (!provider.available || !provider.mcpUrl) return null;
  if (provider.id === "posthog") {
    if (!credentials.apiKey) return null;
    return {
      type: "url" as const,
      name: "posthog",
      url: `${provider.mcpUrl}?tools=${POSTHOG_ALLOWED_TOOLS.join(",")}`,
      authorization_token: credentials.apiKey,
    };
  }
  // No public MCP for other providers yet.
  return null;
}

export interface AskPostHogResult {
  answer: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}

interface PriorTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askDataTool(
  question: string,
  provider: ProviderConfig,
  credentials: Credentials,
  history: PriorTurn[] = [],
): Promise<AskPostHogResult> {
  if (!provider.available) {
    return {
      answer: `${provider.name} live Q&A isn't available yet — its MCP server hasn't shipped. Your credentials are saved; we'll turn this on the moment it's available.`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: null,
    };
  }
  const mcpServer = buildMcpServerConfig(provider, credentials);
  if (!mcpServer) {
    return {
      answer: `Couldn't reach ${provider.name} — credentials missing or invalid.`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: null,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const projectId = credentials.projectId ?? "(unknown)";
  const host = credentials.host ?? "";
  const messages: PriorTurn[] = [
    ...history,
    { role: "user", content: question },
  ];

  const res = await anthropic.beta.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: `You are a senior data analyst answering questions for a busy product manager during a live meeting. They want ANSWERS, not questions back. Their data tool is ${provider.name}.

Hard rules:
- Never ask the user clarifying questions about their data setup. Figure it out.
- ALWAYS try to answer. When you don't know which event tracks something, use execute-sql to explore: list distinct event names from the events table (e.g. SELECT DISTINCT event FROM events WHERE timestamp > now() - INTERVAL 30 DAY ORDER BY count() DESC LIMIT 50), find the events whose name is most plausibly related to the question (e.g. "signup" matches "user_signed_up", "signup_completed", "$signup"), then run the actual query against that event. Only use docs-search as a last resort.
- Lead with the number. Then a short, plain-English sentence. Then "(via event '<name>')" so the PM knows which event you used.
- Be concise: 3 sentences or fewer. This is a live meeting chat.
- If a follow-up question references "that" or "those" or "the X you mentioned", use the conversation history to resolve it.
- If after exploring you genuinely cannot find a relevant event, say so plainly with what you tried — don't ask the PM to specify.

Project ID: ${projectId}.${host ? ` Host: ${host}.` : ""} Today: ${today}.
Region/timezone: assume the project's local time matches the data.`,
    messages,
    mcp_servers: [mcpServer],
    betas: ["mcp-client-2025-04-04"],
  });

  const textParts: string[] = [];
  const toolCalls: AskPostHogResult["toolCalls"] = [];

  for (const block of res.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
    if (block.type === "mcp_tool_use") {
      toolCalls.push({
        name: String(block.name ?? ""),
        input: block.input,
      });
    }
  }

  return {
    answer: textParts.join("\n").trim(),
    toolCalls,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
    raw: res,
  };
}

export interface FollowupQuestion {
  question: string;
  reasoning: string;
  answer?: string;
  posthogUrls?: string[];
}

export interface EmailDraft {
  subject: string;
  body: string;
}

const POSTHOG_URL_RE = /https?:\/\/[^\s)]*posthog\.com[^\s)]*/gi;

export function extractPostHogUrls(text: string): string[] {
  const matches = text.match(POSTHOG_URL_RE) ?? [];
  return Array.from(new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, ""))));
}

// Identifies genuine PostHog/analytics questions from a meeting transcript.
// Doesn't actually query PostHog — that's the next phase. We only want the
// list of questions worth asking.
export async function analyzeTranscript(transcript: string): Promise<FollowupQuestion[]> {
  if (!transcript.trim()) return [];

  const res = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    system: `You read meeting transcripts and surface concrete data questions
that the team would benefit from having answered with PostHog analytics.

Rules:
- Only include questions where the answer would be actionable and where
  PostHog (event analytics, feature flags, experiments, dashboards, error
  tracking) could plausibly answer it.
- Skip rhetorical questions, hypotheticals, opinions, and anything not
  data-shaped.
- 0–5 items. If nothing qualifies, return an empty array.
- Each question must be self-contained (no "this", "that thing", "the X we
  discussed" — replace with the concrete subject).
- Return ONLY a JSON array. No prose, no code fences.

Schema: [{"question": "<self-contained question>", "reasoning": "<one-sentence why this came up in the meeting>"}]`,
    messages: [{ role: "user", content: transcript }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  // Strip optional code fences if Claude added them despite the instruction.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((p) => {
      const obj = p as { question?: unknown; reasoning?: unknown };
      if (typeof obj.question !== "string") return [];
      return [{
        question: obj.question,
        reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
      }];
    });
  } catch (err) {
    console.error("[analyzeTranscript] failed to parse JSON:", err);
    console.error("[analyzeTranscript] raw text length:", cleaned.length);
    console.error("[analyzeTranscript] raw text:\n" + cleaned);
    return [];
  }
}

export interface ComposeInput {
  meetingTitle: string | null;
  participants: Array<{ name: string; email?: string | null }>;
  qa: Array<{ question: string; reasoning: string; answer: string; posthogUrls: string[] }>;
}

export async function composeFollowupEmail(input: ComposeInput): Promise<EmailDraft> {
  const { meetingTitle, participants, qa } = input;

  const qaBlock = qa
    .map(
      (item, i) =>
        `Q${i + 1}: ${item.question}\nWhy this came up: ${item.reasoning}\nPostHog answer: ${item.answer}\nPostHog links: ${item.posthogUrls.length ? item.posthogUrls.join(" ") : "(none)"}`,
    )
    .join("\n\n");

  const userMsg = `Meeting title: ${meetingTitle ?? "(untitled)"}
Participants: ${participants.map((p) => p.name).join(", ") || "(unknown)"}

Questions and answers from PostHog:

${qaBlock}`;

  const res = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    system: `You draft a brief, actionable follow-up email to participants of a meeting where data-shaped questions came up.

Hard rules:
- Bottom line up front. The first sentence after the greeting is the single most important takeaway, with concrete numbers if you have them.
- Be direct and useful. No "I hope this email finds you well", no filler, no apologies.
- If an answer was inconclusive or PostHog couldn't query it, say so plainly — don't pad.
- Preserve every PostHog URL you receive. Inline them next to the relevant finding so people can click through.
- Keep it tight. ~150-300 words for the body.

Output format (return EXACTLY this, no code fences, no commentary):

Subject: <one-line, informative, no fluff>

Hi team,

<TL;DR sentence — the headline finding>

What we found
- <Finding 1, with concrete number, then a PostHog link if available>
- <Finding 2 …>
- <…>

What to do next
- <Specific actionable step 1>
- <Specific actionable step 2>
- <(optional) step 3>

— PostHog (via the meeting bot)`,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  // First line should be `Subject: ...`. Pull it off, the rest is the body.
  const lines = text.split(/\r?\n/);
  let subject = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Subject:\s*(.+)$/i);
    if (m) {
      subject = m[1].trim();
      bodyStart = i + 1;
      break;
    }
  }
  const body = lines.slice(bodyStart).join("\n").trim();

  return {
    subject: subject || "Meeting follow-up",
    body: body || text,
  };
}
