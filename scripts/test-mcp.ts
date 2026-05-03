import { askDataTool } from "../src/lib/anthropic";
import { PROVIDERS } from "../src/lib/providers";

async function main() {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_HOST ?? "https://us.posthog.com";
  if (!apiKey || !projectId) {
    throw new Error("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID must be set in .env.local");
  }

  const question =
    process.argv.slice(2).join(" ") ||
    "How many events did we receive in the last 7 days?";

  console.log(`> ${question}\n`);
  const t0 = Date.now();
  const result = await askDataTool(question, PROVIDERS.posthog, {
    apiKey,
    projectId,
    host,
  });
  const ms = Date.now() - t0;

  console.log("--- ANSWER ---");
  console.log(result.answer);
  console.log("\n--- TOOL CALLS ---");
  for (const tc of result.toolCalls) {
    console.log(`  ${tc.name}`);
  }
  console.log(
    `\nlatency=${ms}ms  tokens_in=${result.usage.inputTokens}  tokens_out=${result.usage.outputTokens}`,
  );
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
