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

  if (provider.id === "mixpanel") {
    if (!credentials.accessToken) return null;
    const region = (credentials.region ?? "us").toLowerCase();
    const url =
      region === "eu"
        ? "https://mcp-eu.mixpanel.com/mcp"
        : region === "in"
          ? "https://mcp-in.mixpanel.com/mcp"
          : "https://mcp.mixpanel.com/mcp";
    return {
      type: "url" as const,
      name: "mixpanel",
      url,
      authorization_token: credentials.accessToken,
    };
  }

  if (provider.id === "amplitude") {
    if (!credentials.accessToken) return null;
    const region = (credentials.region ?? "us").toLowerCase();
    const url =
      region === "eu"
        ? "https://mcp.eu.amplitude.com/mcp"
        : "https://mcp.amplitude.com/mcp";
    return {
      type: "url" as const,
      name: "amplitude",
      url,
      authorization_token: credentials.accessToken,
    };
  }

  return null;
}

export interface AskPostHogResult {
  answer: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
  // The full prompt sent to the model (system + user). Captured so we can
  // rerun evals against it later.
  prompt: { system: string; user: string };
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
      prompt: { system: "", user: question },
    };
  }
  const mcpServer = buildMcpServerConfig(provider, credentials);
  if (!mcpServer) {
    return {
      answer: `Couldn't reach ${provider.name} — credentials missing or invalid.`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: null,
      prompt: { system: "", user: question },
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const projectId = credentials.projectId ?? "(unknown)";
  const host = credentials.host ?? "";
  const messages: PriorTurn[] = [
    ...history,
    { role: "user", content: question },
  ];

  const systemPrompt = `You are a senior data analyst answering questions for a busy product manager during a live meeting. They want ANSWERS, not questions back. Their data tool is ${provider.name}.

Hard rules:
- Never ask the user clarifying questions about their data setup. Figure it out.
- ALWAYS try to answer. When you don't know which event tracks something, use execute-sql to explore: list distinct event names from the events table (e.g. SELECT DISTINCT event FROM events WHERE timestamp > now() - INTERVAL 30 DAY ORDER BY count() DESC LIMIT 50), find the events whose name is most plausibly related to the question (e.g. "signup" matches "user_signed_up", "signup_completed", "$signup"), then run the actual query against that event. Only use docs-search as a last resort.
- Lead with the number. Then a short, plain-English sentence. Then "(via event '<name>')" so the PM knows which event you used.
- Be concise: 3 sentences or fewer. This is a live meeting chat.
- If a follow-up question references "that" or "those" or "the X you mentioned", use the conversation history to resolve it.
- If after exploring you genuinely cannot find a relevant event, say so plainly with what you tried — don't ask the PM to specify.

Project ID: ${projectId}.${host ? ` Host: ${host}.` : ""} Today: ${today}.
Region/timezone: assume the project's local time matches the data.`;

  // Sonnet for the live path: good quality, ~3x faster than Opus, which
  // matters when the bot is replying mid-call. 4000 max_tokens leaves room
  // for 2-3 tool calls + a short final answer.
  const res = await anthropic.beta.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
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
    prompt: { system: systemPrompt, user: question },
  };
}

// Strategic-analyst variant for post-meeting follow-up. Uses a richer system
// prompt that asks for structured findings, footnotes for the events/decisions
// the model used, and actionable + supportive framing. Returns a longer-form
// markdown answer suitable for an email/Slack body.
export async function askDataToolStrategic(
  question: string,
  reasoning: string,
  provider: ProviderConfig,
  credentials: Credentials,
): Promise<AskPostHogResult> {
  if (!provider.available) {
    return {
      answer: `${provider.name} live Q&A isn't available yet — its MCP server hasn't shipped.`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: null,
      prompt: { system: "", user: question },
    };
  }
  const mcpServer = buildMcpServerConfig(provider, credentials);
  if (!mcpServer) {
    return {
      answer: `Couldn't reach ${provider.name} — credentials missing or invalid.`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: null,
      prompt: { system: "", user: question },
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const projectId = credentials.projectId ?? "(unknown)";
  const host = credentials.host ?? "";

  const systemPrompt = `You are a senior product analyst writing the data-backed answer to ONE specific question that came up in a meeting. The reader is a busy PM. Their data tool is ${provider.name}.

Operating principles:
- Best-guess, never ask. Use your judgment about which events, properties, and time windows are most relevant. If multiple interpretations exist, pick the one most useful to a PM and note your choice in the footnotes.
- Strategic reasoning. Don't just dump a number. Compare to a baseline, segment by something meaningful (cohort, platform, surface), and note whether the result is significant or noisy. If you only have one data point, say so.
- Bottom line up front. First sentence is the headline finding with the concrete number.
- Be useful, not just accurate. Either give an action ("→ X is likely the lever") or supportive framing ("→ this looks healthy; here's the bar to watch for").
- If the question can't be answered today (no relevant events), say so plainly AND suggest the specific event(s) and properties the team should add to make it answerable. Format suggestions as a short "**Suggested instrumentation:**" bullet list. Don't pad — one or two concrete events with example property names.
- Footnotes for transparency. End with a short "Notes" section listing: which event(s) you queried, which date range, any caveats, and any judgment calls you made (e.g. "interpreted 'churn' as users with no $pageview in 14d").
- Preserve any URLs returned by tool calls (insight links, dashboard links). Inline them next to the relevant finding.
- Markdown is welcome (bold, bullets, links). No headings larger than ###.

Length: ~120-220 words. This is a written follow-up, not a chat reply.

Project ID: ${projectId}.${host ? ` Host: ${host}.` : ""} Today: ${today}.`;

  const userPrompt = `Question from the meeting: ${question}

Why this came up: ${reasoning}

Answer it now using the data, with footnotes for the events and date ranges you used.`;

  // Use Sonnet for speed (Opus is 3-5x slower per call). The strategic
  // analyst writes ~150-300 words plus does 2-5 tool calls, so we need a
  // generous output budget (each tool call eats tokens too). 6000 is plenty
  // for the typical case while leaving headroom.
  //
  // Hard 120s timeout per question. PostHog's MCP often does many search
  // calls (insights/actions/dashboards) for thorough analysis — 60s was
  // cutting off mid-search. With max 4 questions sequentially, 4 × 120s
  // = 480s worst case but typical case is 60s/q so we comfortably fit
  // under Vercel's 300s function cap.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  let res;
  try {
    res = await anthropic.beta.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        mcp_servers: [mcpServer],
        betas: ["mcp-client-2025-04-04"],
      },
      { signal: ac.signal },
    );
  } finally {
    clearTimeout(timer);
  }

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
    prompt: { system: systemPrompt, user: userPrompt },
  };
}

// Synthesize a "Need to know" preamble + instrumentation-gaps callout from
// the answered follow-up questions. Quick Sonnet call — adds ~5-10s but
// gives the report a proper TL;DR.
export interface ReportPreamble {
  needToKnow: string;        // 2-4 short bullets, markdown
  instrumentationGaps: string; // empty string if none, else bulleted suggestions
  usage: { model: string; inputTokens: number; outputTokens: number };
}

export async function buildReportPreamble(
  answered: Array<{ question: string; answer: string }>,
): Promise<ReportPreamble> {
  const empty: ReportPreamble = {
    needToKnow: "",
    instrumentationGaps: "",
    usage: { model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 },
  };
  if (answered.length === 0) {
    return empty;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: `You write a 2-section preamble for a follow-up report.

Section 1 — "Need to know"
- 2-4 bullets, each ONE sentence.
- Lead with the sharpest finding (a number, a delta, or "this couldn't be answered today").
- Skip anything obvious or filler. The reader is busy.

Section 2 — "Instrumentation gaps" (omit entirely if no gaps)
- ONLY include if one or more questions couldn't be answered because events were missing.
- For each such question, name the specific event(s) and property(ies) the team should add.
- One bullet per gap, max 4 gaps.

Return ONLY valid JSON, no prose, no code fences:
{ "needToKnow": "<markdown bullets>", "instrumentationGaps": "<markdown bullets, or empty string if none>" }`,
        messages: [
          {
            role: "user",
            content: answered
              .map(
                (a, i) => `Q${i + 1}: ${a.question}\n\nAnswer:\n${a.answer}`,
              )
              .join("\n\n---\n\n"),
          },
        ],
      },
      { signal: ac.signal },
    );
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(text) as ReportPreamble;
    return {
      needToKnow: typeof parsed.needToKnow === "string" ? parsed.needToKnow : "",
      instrumentationGaps:
        typeof parsed.instrumentationGaps === "string"
          ? parsed.instrumentationGaps
          : "",
      usage: {
        model: "claude-sonnet-4-6",
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
    };
  } catch (err) {
    console.warn("[buildReportPreamble] failed:", err);
    return empty;
  } finally {
    clearTimeout(timer);
  }
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
export interface AnalyzeResult {
  questions: FollowupQuestion[];
  usage: { model: string; inputTokens: number; outputTokens: number };
}

export async function analyzeTranscript(transcript: string): Promise<FollowupQuestion[]> {
  const r = await analyzeTranscriptWithUsage(transcript);
  return r.questions;
}

export async function analyzeTranscriptWithUsage(
  transcript: string,
): Promise<AnalyzeResult> {
  const empty: AnalyzeResult = {
    questions: [],
    usage: { model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 },
  };
  if (!transcript.trim()) return empty;

  // Hard 45s timeout. Without this, an Anthropic outage / retry loop can
  // silently consume the entire 300s function budget.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);

  let res;
  try {
    res = await anthropic.messages.create(
      {
        // Sonnet is plenty for JSON extraction and 3-5x faster than Opus.
        model: "claude-sonnet-4-6",
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
      },
      { signal: ac.signal },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[analyzeTranscript] failed:", msg);
    return empty;
  } finally {
    clearTimeout(timer);
  }

  const usage = {
    model: "claude-sonnet-4-6",
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  // Strip optional code fences if Claude added them despite the instruction.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return { questions: [], usage };
    const questions = parsed.flatMap((p) => {
      const obj = p as { question?: unknown; reasoning?: unknown };
      if (typeof obj.question !== "string") return [];
      return [{
        question: obj.question,
        reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
      }];
    });
    return { questions, usage };
  } catch (err) {
    console.error("[analyzeTranscript] failed to parse JSON:", err);
    console.error("[analyzeTranscript] raw text length:", cleaned.length);
    console.error("[analyzeTranscript] raw text:\n" + cleaned);
    return { questions: [], usage };
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
    model: "claude-opus-4-7",
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
