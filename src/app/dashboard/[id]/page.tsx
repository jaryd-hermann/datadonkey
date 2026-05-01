"use client";

import { useEffect, useState, use } from "react";

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

  async function generate() {
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/meetings/${id}/followup`, { method: "POST" });
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
      <div className="min-h-dvh bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl text-zinc-500">Loading…</div>
      </div>
    );
  }

  const transcriptReady = !!meeting.transcript && meeting.transcript.length > 0;
  const ranOnce = !!meeting.followupsAt;
  const noQuestions = ranOnce && meeting.followups.length === 0;

  return (
    <div className="min-h-dvh bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
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
                Identifies data questions in the transcript, queries PostHog for each,
                and drafts a follow-up email. Takes ~30–60s.
              </p>
            </div>
            <button
              onClick={generate}
              disabled={running || !transcriptReady}
              className="shrink-0 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {running ? "Working…" : ranOnce ? "Re-generate" : "Generate"}
            </button>
          </div>
          {!transcriptReady && (
            <div className="mt-4 rounded-md bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950">
              Waiting for the call to end and transcript to land (status: <code>done</code>).
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
            Questions for PostHog
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

        {/* 4. Email draft */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Email we&apos;d send to participants
          </h2>
          {!ranOnce ? (
            <div className="mt-3 text-sm text-zinc-500">
              Will be drafted after &ldquo;Generate&rdquo; runs.
            </div>
          ) : noQuestions ? (
            <div className="mt-3 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              No email — nothing actionable to share.
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Subject
              </div>
              <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {meeting.emailSubject ?? "(no subject)"}
              </div>
              <div className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Body
              </div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
{meeting.emailDraft}
              </pre>
            </div>
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
              Will appear here after the call ends.
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
    </div>
  );
}
