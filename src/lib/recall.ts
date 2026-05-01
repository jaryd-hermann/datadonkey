// Minimal Recall.ai client. Docs: https://docs.recall.ai/

const REGION = process.env.RECALL_REGION ?? "us-west-2";
const BASE_URL = `https://${REGION}.recall.ai`;

function authHeader(): Record<string, string> | null {
  const key = process.env.RECALL_API_KEY;
  if (!key) return null;
  return { Authorization: `Token ${key}` };
}

export interface CreateBotInput {
  meetingUrl: string;
  webhookUrl: string;
  botName?: string;
}

export interface CreateBotResponse {
  id: string;
  meeting_url: string;
}

// Recall stores transcription credentials at the account level (set them at
// https://us-west-2.recall.ai/dashboard/transcription). We just toggle which
// provider to use here. Set DEEPGRAM_API_KEY in env as a boolean-like flag —
// the actual key lives in your Recall account.
function transcriptionProvider() {
  if (process.env.DEEPGRAM_API_KEY) {
    return { deepgram_streaming: {} };
  }
  return { meeting_captions: {} };
}

export async function createBot(input: CreateBotInput): Promise<CreateBotResponse> {
  const auth = authHeader();
  if (!auth) throw new Error("RECALL_API_KEY is not set");

  const body = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName ?? "PostHog",
    recording_config: {
      transcript: { provider: transcriptionProvider() },
      realtime_endpoints: [
        {
          type: "webhook",
          url: input.webhookUrl,
          events: ["transcript.data"],
        },
      ],
    },
  };

  const res = await fetch(`${BASE_URL}/api/v1/bot/`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Recall createBot failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function sendChatMessage(botId: string, message: string): Promise<void> {
  const auth = authHeader();
  if (!auth) {
    console.warn(`[recall] sendChatMessage skipped (no RECALL_API_KEY): "${message}"`);
    return;
  }
  try {
    const res = await fetch(`${BASE_URL}/api/v1/bot/${botId}/send_chat_message/`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "everyone", message }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[recall] sendChatMessage failed: ${res.status} ${text}`);
    }
  } catch (err) {
    console.error(`[recall] sendChatMessage error:`, err);
  }
}

export async function getBot(botId: string): Promise<unknown> {
  const auth = authHeader();
  if (!auth) throw new Error("RECALL_API_KEY is not set");
  const res = await fetch(`${BASE_URL}/api/v1/bot/${botId}/`, { headers: auth });
  if (!res.ok) throw new Error(`Recall getBot failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Returns a flat array of {speaker, text} ordered by start time.
export interface TranscriptLine {
  speaker: string | null;
  text: string;
}

export async function getTranscriptLines(botId: string): Promise<TranscriptLine[]> {
  const auth = authHeader();
  if (!auth) throw new Error("RECALL_API_KEY is not set");
  const res = await fetch(`${BASE_URL}/api/v1/bot/${botId}/transcript/`, { headers: auth });
  if (!res.ok) throw new Error(`Recall getTranscript failed: ${res.status} ${await res.text()}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;

  // Recall's transcript endpoint returns chunks; shape varies slightly across
  // payload versions. Each chunk has either `participant.name` or
  // `speaker_name`, and either a flat `text` field or a `words[]` array.
  return raw.map((chunk) => {
    const speaker =
      ((chunk.participant as Record<string, unknown> | undefined)?.name as string | null | undefined) ??
      ((chunk.speaker as Record<string, unknown> | undefined)?.name as string | null | undefined) ??
      (typeof chunk.speaker === "string" ? chunk.speaker : null) ??
      (typeof chunk.speaker_name === "string" ? chunk.speaker_name : null) ??
      null;
    const directText = typeof chunk.text === "string" ? chunk.text : null;
    const words = Array.isArray(chunk.words)
      ? (chunk.words as Array<{ text?: string }>).map((w) => w.text ?? "").join(" ")
      : null;
    const text = (directText ?? words ?? "").replace(/\s+([.,!?])/g, "$1").trim();
    return { speaker, text };
  }).filter((l) => l.text.length > 0);
}

export interface ParticipantSummary {
  name: string;
  email?: string | null;
}

// Best-effort participant extraction from a getBot() payload. Recall has a
// few payload shapes; we look in the common places and fall back to inferring
// from the transcript on the caller's side.
export function extractParticipants(bot: unknown): ParticipantSummary[] {
  const b = bot as Record<string, unknown>;
  const out: ParticipantSummary[] = [];
  const seen = new Set<string>();

  const candidates: unknown[] = [];
  if (Array.isArray(b?.participants)) candidates.push(...(b.participants as unknown[]));
  const meta = b?.meeting_metadata as Record<string, unknown> | undefined;
  if (Array.isArray(meta?.participants)) candidates.push(...(meta!.participants as unknown[]));
  if (Array.isArray(meta?.attendees)) candidates.push(...(meta!.attendees as unknown[]));

  for (const c of candidates) {
    const p = c as Record<string, unknown>;
    const name =
      (typeof p.name === "string" ? p.name : null) ??
      (typeof p.display_name === "string" ? p.display_name : null);
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      email: typeof p.email === "string" ? p.email : null,
    });
  }
  return out;
}
