"use client";

import { useEffect, useState, use } from "react";
import { AppShell } from "@/components/AppShell";

interface Question {
  id: string;
  question: string;
  answer: string;
  askerName: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface Followup {
  question: string;
  reasoning: string;
  answer?: string;
  posthogUrls?: string[];
}

interface Participant {
  name: string;
  email?: string | null;
}

interface Meeting {
  id: string;
  recallBotId: string;
  meetingUrl: string;
  title: string | null;
  status: string;
  createdAt: string;
  endedAt: string | null;
  transcript: string | null;
  participants: Participant[];
  followups: Followup[];
  followupsAt: string | null;
  emailSubject: string | null;
  emailDraft: string | null;
  emailDraftAt: string | null;
  followupReport: string | null;
  followupEmailedAt: string | null;
  followupSlackedAt: string | null;
  questions: Question[];
}

export default function MeetingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/meetings/${id}`);
    if (r.ok) {
      const j = await r.json();
      setMeeting(j.meeting);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [id]);

  async function generate(force = false) {
    setRunning(true);
    setError(null);
    const url = force
      ? `/api/meetings/${id}/followup?force=1`
      : `/api/meetings/${id}/followup`;
    const r = await fetch(url, { method: "POST" });
    const j = await r.json();
    setRunning(false);
    if (!r.ok) {
      setError(j.error ?? "Failed");
      return;
    }
    await load();
  }

  if (!meeting) {
    return (
      <AppShell showAppNav>
        <div className="mx-auto max-w-3xl px-6 py-16 text-zinc-500">Loading…</div>
      </AppShell>
    );
  }

  const transcriptReady = !!meeting.transcript && meeting.transcript.length > 0;
  const ranOnce = !!meeting.followupsAt;
  const noQuestions = ranOnce && meeting.followups.length === 0;
  // The fn may have been started but not yet finished (e.g. it timed out
  // server-side, or it's still running and we navigated away mid-call).
  // Treat this as still working so the UI doesn't lie.
  const inflight = running || (!!(meeting as { followupAttempted?: boolean }).followupAttempted && !ranOnce);
  const canGenerate = !inflight;

  return (
    <AppShell showAppNav>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6">
          <a
            href="/dashboard"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← back to dashboard
          </a>
        </div>

        {/* 1. Meeting info */}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {meeting.title || "Untitled meeting"}
        </h1>
        <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800 dark:text-zinc-400">
            {meeting.status}
          </span>
          <span>{new Date(meeting.createdAt).toLocaleString()}</span>
        </div>
        <a
          href={meeting.meetingUrl}
          target="_blank"
          className="mt-1 block truncate font-mono text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {meeting.meetingUrl}
        </a>

        <section className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Participants
          </h2>
          {meeting.participants.length === 0 ? (
            <div className="mt-2 text-sm text-zinc-500">—</div>
          ) : (
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-zinc-800 dark:text-zinc-200">
              {meeting.participants.map((p, i) => (
                <li key={i}>
                  {p.name}
                  {p.email && (
                    <span className="ml-2 font-mono text-xs text-zinc-500">{p.email}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Single CTA that runs the whole pipeline */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                Generate follow-up
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Identifies data questions in the transcript, queries your data tool for each,
                and drafts a follow-up email. Takes ~30–60s.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => generate(false)}
                disabled={!canGenerate}
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {inflight ? "Working…" : ranOnce ? "Re-generate" : "Generate"}
              </button>
              {inflight && !running && (
                <button
                  onClick={() => generate(true)}
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                  title="The previous run never finished. Click to start fresh."
                >
                  Looks stuck — force re-run
                </button>
              )}
            </div>
          </div>
          {!transcriptReady && !running && (
            <div className="mt-4 rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950">
              We&apos;ll pull the transcript from Recall when you click Generate. Best to wait until the call has ended (or some has been spoken).
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </section>

        {/* 3. Questions (with answers when present) */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Data questions surfaced
          </h2>
          {!ranOnce && (
            <div className="mt-3 text-sm text-zinc-500">
              Run &ldquo;Generate&rdquo; to identify data questions from the transcript.
            </div>
          )}
          {noQuestions && (
            <div className="mt-3 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              Nothing relevant here — no data-shaped questions surfaced in this transcript.
            </div>
          )}
          {ranOnce && meeting.followups.length > 0 && (
            <ul className="mt-4 space-y-4">
              {meeting.followups.map((f, i) => (
                <li
                  key={i}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Q{i + 1}. {f.question}
                  </div>
                  {f.reasoning && (
                    <div className="mt-1 text-xs italic text-zinc-500">{f.reasoning}</div>
                  )}
                  {f.answer && (
                    <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                      {f.answer}
                    </div>
                  )}
                  {f.posthogUrls && f.posthogUrls.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {f.posthogUrls.map((u) => (
                        <li key={u}>
                          <a
                            href={u}
                            target="_blank"
                            className="break-all font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4. Followup report (rich) + delivery status */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Follow-up report
            </h2>
            <div className="flex items-center gap-2">
              <DeliveryPill
                ok={!!meeting.followupEmailedAt}
                label={meeting.followupEmailedAt ? "Emailed" : "Email pending"}
              />
              <DeliveryPill
                ok={!!meeting.followupSlackedAt}
                label={meeting.followupSlackedAt ? "Slacked" : "Slack pending"}
              />
            </div>
          </div>
          {!ranOnce ? (
            <div className="mt-3 text-sm text-zinc-500">
              Will be drafted after &ldquo;Generate&rdquo; runs.
            </div>
          ) : noQuestions ? (
            <div className="mt-3 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              Nothing actionable to share — no follow-up sent.
            </div>
          ) : (
            <>
              {meeting.emailSubject && (
                <div className="mt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Subject
                  </div>
                  <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {meeting.emailSubject}
                  </div>
                </div>
              )}
              <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-950">
                <MarkdownView text={meeting.followupReport ?? meeting.emailDraft ?? ""} />
              </div>
            </>
          )}
        </section>

        {/* 2. Transcript (last so it doesn't dominate the page) */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Transcript
          </h2>
          {transcriptReady ? (
            <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
{meeting.transcript}
            </pre>
          ) : (
            <div className="mt-2 text-sm text-zinc-500">
              Click Generate to pull the latest transcript from Recall.
            </div>
          )}
        </section>

        {meeting.questions.length > 0 && (
          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Live Q&amp;A from this meeting
            </h2>
            <ul className="mt-3 space-y-3">
              {meeting.questions.map((q) => (
                <li key={q.id} className="text-sm">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-zinc-500">{q.askerName ?? "?"}: </span>
                    {q.question}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {q.answer}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function DeliveryPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " +
        (ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400")
      }
    >
      {ok ? "✓ " : ""}
      {label}
    </span>
  );
}

// Lightweight markdown renderer. Supports h2/h3 headings, bold, bullets,
// links and the `---` divider used by the report. Adequate for prototype.
function MarkdownView({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
      {blocks.map((block, i) => {
        if (block.trim() === "---") {
          return <hr key={i} className="my-4 border-zinc-200 dark:border-zinc-800" />;
        }
        if (/^##\s/.test(block)) {
          return (
            <h2 key={i} className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {renderInline(block.replace(/^##\s/, ""))}
            </h2>
          );
        }
        if (/^###\s/.test(block)) {
          return (
            <h3 key={i} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {renderInline(block.replace(/^###\s/, ""))}
            </h3>
          );
        }
        const lines = block.split(/\n/);
        if (lines.every((l) => /^[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="ml-5 list-disc space-y-1">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // very small inline parser: bold + links
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    if (m[1] !== undefined) parts.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined && m[3] !== undefined)
      parts.push(
        <a key={key++} href={m[3]} target="_blank" className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400">
          {m[2]}
        </a>,
      );
    else if (m[4] !== undefined)
      parts.push(
        <a key={key++} href={m[4]} target="_blank" className="break-all font-mono text-xs text-blue-600 underline dark:text-blue-400">
          {m[4]}
        </a>,
      );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
