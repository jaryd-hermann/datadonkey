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
    // OAuth access token takes precedence — same Bearer shape as a PAT but
    // shorter-lived + auto-refreshed elsewhere.
    const token = credentials.oauthAccessToken || credentials.apiKey;
    if (!token) return null;
    return {
      type: "url" as const,
      name: "posthog",
      url: `${provider.mcpUrl}?tools=${POSTHOG_ALLOWED_TOOLS.join(",")}`,
      authorization_token: token,
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

// Recall/Deepgram transcripts capture every disfluency, partial word, and
// false start verbatim. The downstream analyzer chokes on the noise — it
// can't extract clean self-contained questions from "we just turn it on and
// just see conversion, like, fifty fifty something like that?" so it gives
// up and returns []. This pre-pass uses Haiku (fast + cheap) to reflow the
// transcript into clean turns while preserving speakers and meaning.
//
// Fails soft: if the cleanup call errors or times out, the caller should
// use the original transcript — the analyzer can still try.
export interface CleanedTranscript {
  text: string;  // cleaned transcript; empty string on failure
  usage: { model: string; inputTokens: number; outputTokens: number };
  ok: boolean;
}

const CLEANUP_SYSTEM_PROMPT = `You clean up raw speech-to-text meeting transcripts so downstream analysis can extract clean questions and topics. Input format is one line per turn: \`Speaker: text\`.

Your job:
- Remove disfluencies: "um", "uh", "like", "you know", "I mean", "so", and similar filler when used as filler.
- Stitch together broken sentences that span multiple turns by the same speaker (transcripts often split a single thought across lines mid-word).
- Drop or merge tiny acknowledgements ("yeah", "right", "mhmm", "ok") UNLESS they are direct, meaningful answers to a preceding question. Don't lose substantive content.
- Remove false starts where the speaker abandons a sentence and restarts — keep only the completed thought.
- Fix obviously misheard words when context makes them clear (e.g. "post hoc" not "post hawk").
- Preserve every speaker's identity and turn order — DO NOT merge across speakers.
- Preserve every concrete number, metric, name, date, feature, and technical term verbatim. Never invent numbers.
- Preserve question marks — they're the strongest signal for the downstream analyzer.
- DO NOT summarize, paraphrase the meaning, or remove content that has any substantive value (even if conversational). This is a noise-reduction pass, not a summarization pass.
- DO NOT add commentary, headers, or surrounding text. Output the cleaned transcript directly, same \`Speaker: text\` format, one turn per line.

If the input is already clean, return it essentially unchanged.`;

// Chunk transcript on speaker-turn boundaries so each Haiku call stays well
// inside the SDK's non-streaming budget. Each chunk targets ~16k chars input
// (~4k tokens), which lets max_tokens stay at 4096 and runs in ~5-10s.
function chunkTranscriptByTurns(transcript: string, targetChunkChars = 16_000): string[] {
  const lines = transcript.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    if (currentLen + line.length + 1 > targetChunkChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

async function cleanOneChunk(
  chunk: string,
): Promise<{ text: string; ok: boolean; inputTokens: number; outputTokens: number }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);
  try {
    const res = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: CLEANUP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: chunk }],
      },
      { signal: ac.signal },
    );
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();
    if (!text) return { text: "", ok: false, inputTokens: 0, outputTokens: 0 };
    return {
      text,
      ok: true,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch (err) {
    console.warn("[cleanTranscript] chunk failed:", err);
    return { text: "", ok: false, inputTokens: 0, outputTokens: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanTranscriptWithUsage(
  transcript: string,
): Promise<CleanedTranscript> {
  const empty: CleanedTranscript = {
    text: "",
    usage: { model: "claude-haiku-4-5", inputTokens: 0, outputTokens: 0 },
    ok: false,
  };
  if (!transcript.trim()) return empty;

  const chunks = chunkTranscriptByTurns(transcript);
  // Parallel: each chunk runs independently against Haiku. Per-chunk failures
  // fall back to the raw chunk so we never lose content.
  const results = await Promise.all(chunks.map((c) => cleanOneChunk(c).then((r) => ({ ...r, raw: c }))));

  let inputTokens = 0;
  let outputTokens = 0;
  let anyOk = false;
  const parts: string[] = [];
  for (const r of results) {
    if (r.ok) {
      anyOk = true;
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      parts.push(r.text);
    } else {
      // Fall back to raw chunk so we don't lose content.
      parts.push(r.raw);
    }
  }
  if (!anyOk) return empty;

  return {
    text: parts.join("\n"),
    usage: { model: "claude-haiku-4-5", inputTokens, outputTokens },
    ok: true,
  };
}

// When analyzeTranscript surfaces zero data questions, we still want to give
// the user a signal that the bot read the transcript. Summarizes the main
// themes + why nothing data-shaped came up. UI-only — not emailed.
export interface NoFollowupSummary {
  themes: string;  // bulleted markdown — 2-5 brief topics discussed
  reason: string;  // 1-2 sentence explanation of why no data follow-ups
  usage: { model: string; inputTokens: number; outputTokens: number };
}

export async function summarizeNonDataMeetingWithUsage(
  transcript: string,
): Promise<NoFollowupSummary> {
  const empty: NoFollowupSummary = {
    themes: "",
    reason: "",
    usage: { model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 },
  };
  if (!transcript.trim()) return empty;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: `The analyzer just decided this meeting has no data-shaped follow-up worth sending. You speak for an embedded data scientist who actively listens for both explicit questions AND topics where a data dig would help. Your job is to confirm that judgement to the user — that nothing was asked AND nothing in the topics warranted proactive digging — in two short sections.

Section 1 — "themes": a bulleted markdown list of 2-5 short topics discussed. Each bullet ONE phrase (max ~10 words). No filler ("they discussed…"), just the topic.

Section 2 — "reason": one or two sentences explaining the judgement. Cover BOTH halves: (a) no concrete data question was raised, AND (b) the topics themselves are not ones where pulling data would meaningfully help (e.g. they're qualitative, organizational, hypothetical, or about work that hasn't shipped yet). Be specific to this transcript so it reads as an active call, not a fallback. Don't say "no one asked" without also addressing whether digging in would have been useful.

Return ONLY valid JSON, no prose, no code fences:
{ "themes": "<markdown bullets>", "reason": "<1-2 sentences>" }`,
        messages: [{ role: "user", content: transcript }],
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
    const parsed = JSON.parse(text) as Partial<NoFollowupSummary>;
    return {
      themes: typeof parsed.themes === "string" ? parsed.themes : "",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      usage: {
        model: "claude-sonnet-4-6",
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
    };
  } catch (err) {
    console.warn("[summarizeNonDataMeeting] failed:", err);
    return empty;
  } finally {
    clearTimeout(timer);
  }
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
  // "explicit" = raised in the conversation; "proactive" = the bot anticipated
  // it from the topics discussed. Optional for backwards compatibility with
  // older rows; treat missing as "explicit".
  source?: "explicit" | "proactive";
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
        system: `You are an embedded data-driven PM listening to a team meeting. You read the transcript and surface follow-up questions worth answering with PostHog data — both questions the team asked AND questions a sharp PM would proactively raise from what they heard.

Return questions in two categories:

1. EXPLICIT — questions actually raised in the conversation. Include all three kinds:
   a. Addressed directly to the bot ("Hey PostHog, …", "Hey Post, …")
   b. Raised in monologue (a single speaker thinking out loud)
   c. Raised in team discussion
   Include even if answered live in-call — the follow-up report is the durable record of every data question discussed.

2. PROACTIVE — questions the team did NOT raise but a data-driven PM would, because the answer would meaningfully inform a decision the team is actively making. Hard limits:
   - AT MOST 2 proactive questions per meeting. Quality over volume — skip a marginal one.
   - Must be anchored to a SPECIFIC topic actually discussed in the transcript. Do not invent context.
   - The answer must plausibly already exist in product data. DO NOT propose questions about features that haven't shipped yet, code that hasn't been written, user behavior on something that doesn't exist, or hypothetical futures.
   - Must pass the decision-relevance test: would knowing the answer plausibly change a decision the team is actively considering? If the topic is qualitative (org/process/strategy chat) or already decided, skip.
   - Skip generic vanity-metric fishing ("what's our DAU?") unless the team specifically anchored on that metric.

Rules for all questions:
- Answer must plausibly come from PostHog (event analytics, feature flags, experiments, dashboards, error tracking, session recordings).
- Each question must be self-contained — no "this", "that thing", "the X we discussed". Reconstruct context from the surrounding utterances (e.g. "in the last seven days", "the new checkout page launched last week").
- Skip rhetorical questions, hypotheticals, opinions, and anything not data-shaped.
- Deduplicate near-identical questions, but keep distinct variants ("how many visitors" vs "where did visitors come from" are distinct).
- 0-5 items TOTAL across both categories. If genuinely nothing data-shaped came up AND nothing proactive passes the bar, return [].
- Order: all explicit questions first, then proactive.
- For PROACTIVE questions, the \`reasoning\` field MUST lead with "Proactive — " and explain (a) what specific topic in the transcript motivated it, (b) why knowing the answer would matter to a decision on the table.
- Return ONLY a JSON array. No prose, no code fences.

Schema: [{"question": "<self-contained question>", "reasoning": "<one-sentence why this came up>", "source": "explicit" | "proactive"}]

Worked example. Given a snippet like:
  Alice: do you have an experiment running with hotels on the details page right now?
  Bob: yeah, we flipped the new nav bar yesterday and we're watching conversion by product
  Alice: nice — what's it sitting at?
  Bob: roughly even, but only a day in
You should return at minimum:
  {"question": "What experiments are currently running on the hotels details page?", "reasoning": "Alice asked Bob directly in the call.", "source": "explicit"}
  {"question": "What is the by-product conversion rate trend since the new nav bar shipped?", "reasoning": "Alice asked Bob for the live number; capturing it durably so it's not lost.", "source": "explicit"}
And, as a proactive addition (because the team flipped a launch and is watching conversion casually rather than with a structured monitor):
  {"question": "Is the new nav bar holding conversion across all major products day-over-day, or are any showing regression?", "reasoning": "Proactive — the team flipped the nav bar yesterday and is watching conversion informally; a per-product breakdown would catch regressions they might miss eyeballing the aggregate.", "source": "proactive"}

Note how informal phrasing ("what's it sitting at?", "do you have…") still counts as explicit when the answer is data-shaped. Casual register is fine — the bar is whether PostHog could plausibly answer it.`,
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
    const questions: FollowupQuestion[] = parsed.flatMap((p) => {
      const obj = p as { question?: unknown; reasoning?: unknown; source?: unknown };
      if (typeof obj.question !== "string") return [];
      const source: "explicit" | "proactive" =
        obj.source === "proactive" ? "proactive" : "explicit";
      return [{
        question: obj.question,
        reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
        source,
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
