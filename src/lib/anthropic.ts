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
