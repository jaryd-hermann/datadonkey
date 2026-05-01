// Minimal Recall.ai client. Docs: https://docs.recall.ai/

const REGION = process.env.RECALL_REGION ?? "us-east-1";
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
  status_changes?: Array<{ code: string; created_at: string }>;
}

export async function createBot(input: CreateBotInput): Promise<CreateBotResponse> {
  const auth = authHeader();
  if (!auth) throw new Error("RECALL_API_KEY is not set");

  const body = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName ?? "PostHog",
    recording_config: {
      transcript: {
        provider: { meeting_captions: {} },
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: input.webhookUrl,
          events: ["transcript.data", "transcript.partial_data"],
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
