import Anthropic from "@anthropic-ai/sdk";

// Bypass any local proxy (e.g. PostHog Code's ANTHROPIC_BASE_URL) so we can
// reach api.anthropic.com directly. The MCP server is only supported by the
// upstream API, not the proxy.
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  authToken: null,
  baseURL: "https://api.anthropic.com",
});

// Limit tools at the MCP server level via the ?tools= query param.
// PostHog's MCP returns ~206k tokens of tool definitions otherwise — exceeds
// the model context window. This is the source of truth for which tools the
// bot can call.
const ALLOWED_TOOLS = [
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

const POSTHOG_MCP_URL = `https://mcp.posthog.com/mcp?tools=${ALLOWED_TOOLS.join(",")}`;

export interface AskPostHogResult {
  answer: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}

export async function askPostHog(
  question: string,
  apiKey: string,
  projectId: string,
  host = "https://us.posthog.com",
): Promise<AskPostHogResult> {
  const res = await anthropic.beta.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: `You answer PostHog analytics questions concisely (under 3 sentences) for live conversational use. Use the PostHog MCP tools. The PostHog project ID is ${projectId} and host is ${host}. If the question is not analytics-related, reply "not a PostHog question".`,
    messages: [{ role: "user", content: question }],
    mcp_servers: [
      {
        type: "url",
        url: POSTHOG_MCP_URL,
        name: "posthog",
        authorization_token: apiKey,
      },
    ],
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
