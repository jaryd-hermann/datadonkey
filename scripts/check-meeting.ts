import { prisma } from "../src/lib/db";
async function main() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  for (const m of meetings) {
    console.log(`\n=== ${m.id} ===`);
    console.log(`title: ${m.title ?? "(none)"}  status: ${m.status}  url: ${m.meetingUrl}`);
    console.log(`createdAt: ${m.createdAt.toISOString()}  endedAt: ${m.endedAt?.toISOString() ?? "(none)"}`);
    console.log(`transcript: ${m.transcript ? `${m.transcript.length} chars` : "(empty)"}`);
    console.log(`followups (json): ${m.followups ? `${m.followups.length} chars` : "(none)"}`);
    console.log(`followupsAt: ${m.followupsAt?.toISOString() ?? "(none)"}`);
    console.log(`followupAttempted: ${m.followupAttempted}`);
    console.log(`followupReport: ${m.followupReport ? `${m.followupReport.length} chars` : "(none)"}`);
    console.log(`emailedAt: ${m.followupEmailedAt?.toISOString() ?? "(none)"}`);
    console.log(`slackedAt: ${m.followupSlackedAt?.toISOString() ?? "(none)"}`);
    console.log(`questions: ${m.questions.length} rows`);
    if (m.followups) {
      try {
        const fu = JSON.parse(m.followups) as Array<{ question: string; answer: string }>;
        for (const f of fu) console.log(`  - "${f.question.slice(0, 70)}" -> ${f.answer.slice(0, 100)}`);
      } catch {}
    }
  }
  process.exit(0);
}
main();
