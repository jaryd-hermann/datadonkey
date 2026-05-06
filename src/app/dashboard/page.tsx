"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppShell } from "@/components/AppShell";

interface Question {
  id: string;
  question: string;
  answer: string;
  askerName: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface Meeting {
  id: string;
  recallBotId: string;
  meetingUrl: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  questions: Question[];
}

interface ConnectionInfo {
  exists: boolean;
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
  provider: { id: string; name: string; available: boolean };
  credentials: Record<string, string>;
  projectName: string | null;
  organizationName: string | null;
  prefLive: boolean;
  prefFollowup: boolean;
  calendarConnected: boolean;
  calendarProvider: string | null;
  slackConnected: boolean;
  slackTeamName: string | null;
}

type TabId = "tool" | "calendar" | "slack" | "preferences" | "meetings";

export default function Dashboard() {
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tab, setTab] = useState<TabId>("meetings");

  async function load() {
    const [c, m] = await Promise.all([
      fetch("/api/connection"),
      fetch("/api/recall/bot"),
    ]);
    if (c.ok) setConn(await c.json());
    if (m.ok) {
      const j = await m.json();
      setMeetings(j.meetings ?? []);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4_000);
    return () => clearInterval(t);
  }, []);

  // Restore + persist tab in URL hash for deep-linking and refresh.
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "") as TabId;
    if (TAB_IDS.includes(fromHash)) setTab(fromHash);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  if (!conn) {
    return (
      <AppShell showAppNav>
        <div className="mx-auto max-w-5xl px-6 py-12 text-stone-500">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      showAppNav
      user={{ name: conn.userName, company: conn.userCompany, email: conn.userEmail }}
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressNav tab={tab} setTab={setTab} conn={conn} />
          </div>
          <a
            href="https://chat.whatsapp.com/KjyBAVdBpG95pz4xegnjnu?mode=gi_t"
            target="_blank"
            rel="noopener noreferrer"
            title="Help shape DataDonkey on WhatsApp"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
          >
            <span aria-hidden="true">💬</span>
            <span className="hidden sm:inline">Help build this on WhatsApp</span>
            <span className="sm:hidden">WhatsApp</span>
          </a>
        </div>
        <QuickInviteBar conn={conn} onChange={load} />
        <div className="mt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {tab === "meetings" && (
                <MeetingsTab
                  conn={conn}
                  meetings={meetings}
                  onChange={load}
                />
              )}
              {tab === "tool" && <ToolTab conn={conn} />}
              {tab === "calendar" && <CalendarTab conn={conn} onChange={load} />}
              {tab === "slack" && <SlackTab conn={conn} onChange={load} />}
              {tab === "preferences" && <PreferencesTab conn={conn} onChange={load} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </AppShell>
  );
}

// ----------- nav -----------

const TAB_IDS: TabId[] = ["tool", "calendar", "slack", "preferences", "meetings"];

function ProgressNav({
  tab,
  setTab,
  conn,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  conn: ConnectionInfo;
}) {
  const items: {
    id: TabId;
    label: string;
    done: boolean;
    iconSrc?: string;
  }[] = [
    {
      id: "tool",
      label: conn.connected ? `${conn.provider.name} connected` : `Connect ${conn.provider.name}`,
      done: conn.connected,
      iconSrc: conn.provider.id === "posthog" ? "/posthogicon.png" : undefined,
    },
    {
      id: "calendar",
      label: "Calendar",
      done: conn.calendarConnected,
      iconSrc: "/googlecal.png",
    },
    {
      id: "slack",
      label: "Slack",
      done: conn.slackConnected,
      iconSrc: "/slackicon.png",
    },
    {
      id: "preferences",
      label: "Preferences",
      done: conn.prefLive || conn.prefFollowup,
    },
    { id: "meetings", label: "Meetings", done: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-stone-200 bg-white p-1.5 dark:border-stone-800 dark:bg-stone-900">
      {items.map((it) => {
        const active = it.id === tab;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
              active
                ? "bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900"
                : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                it.done
                  ? active
                    ? "bg-stone-50 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
                    : "bg-emerald-500 text-white"
                  : active
                    ? "border border-stone-50 text-stone-50 dark:border-stone-900 dark:text-stone-900"
                    : "border border-stone-300 text-stone-400 dark:border-stone-700"
              }`}
            >
              {it.done ? "✓" : "·"}
            </span>
            {it.iconSrc && (
              <img src={it.iconSrc} alt="" className="h-3.5 w-3.5 object-contain" />
            )}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuickInviteBar({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const platform = detectPlatform(url);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setBusy(true);
    const r = await fetch("/api/recall/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: url }),
    });
    setBusy(false);
    if (r.ok) {
      setUrl("");
      onChange();
    }
  }

  return (
    <form onSubmit={send} className="mt-4 flex gap-2">
      <div className="relative flex-1">
        <input
          type="url"
          placeholder="Quick invite — paste a Meet, Teams, or Zoom link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-full border border-stone-200 bg-white px-4 py-2 pr-24 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
        />
        {platform !== "unknown" && url && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {platform}
          </span>
        )}
      </div>
      {url && (
        <button
          type="submit"
          disabled={busy || !conn.connected}
          className="rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join"}
        </button>
      )}
    </form>
  );
}

// ----------- meetings tab (main) -----------

function MeetingsTab({
  conn,
  meetings,
  onChange,
}: {
  conn: ConnectionInfo;
  meetings: Meeting[];
  onChange: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = meetings.filter((m) => !isTerminal(m));
  const past = meetings.filter(isTerminal);
  const inCall = active.some((m) => m.status === "in_call");
  const platform = detectPlatform(url);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/recall/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: url }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    setUrl("");
    onChange();
  }

  return (
    <div>
      {/* Status indicator */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <motion.span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            inCall ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"
          }`}
          animate={inCall ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
          transition={inCall ? { duration: 1.4, repeat: Infinity } : { duration: 0 }}
        />
        <span className="text-sm font-medium">
          {inCall ? "DataDonkey is in a call" : "DataDonkey is snoozing"}
        </span>
        {!inCall && (
          <span className="text-xs text-stone-500">
            (invite to a meeting to wake!)
          </span>
        )}
        {active.length > 1 && (
          <span className="text-xs text-stone-500">+{active.length - 1} more dispatched</span>
        )}
      </div>

      {/* Hero: invite DataDonkey to a call. This is the main action — bigger,
          orange CTA, gradient background. */}
      <form
        onSubmit={send}
        className="relative mt-6 overflow-hidden rounded-2xl border-2 border-orange-500/30 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-6 shadow-sm dark:border-orange-500/20 dark:from-orange-950/20 dark:via-amber-950/10 dark:to-rose-950/10 sm:p-8"
      >
        <div className="absolute -right-8 -top-8 h-32 w-32 rotate-12 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-500/10" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-orange-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Main action
            </span>
            <span className="text-xs text-stone-500">supports</span>
            <PlatformIcons />
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-3xl">
            Invite DataDonkey to a meeting
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">
            Drop in a Google Meet, Teams, or Zoom link — DataDonkey joins,
            listens, and follows up with the data that matters.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                type="url"
                placeholder="Paste your meeting link here…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-4 pr-24 text-base font-medium shadow-sm focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-200/60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                required
              />
              {platform !== "unknown" && url && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {platform}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !conn.connected}
              className="shrink-0 rounded-xl bg-orange-600 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-orange-700 hover:shadow-lg disabled:opacity-50 sm:py-4"
            >
              {busy ? "Dispatching…" : "Send DataDonkey →"}
            </button>
          </div>
          {!conn.connected && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              Connect {conn.provider.name} first (Tool tab) to dispatch the bot.
            </p>
          )}
          {error && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          {conn.prefLive && (
            <p className="mt-3 text-xs text-stone-500">
              Once joined, anyone can say{" "}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono dark:bg-stone-800">
                Hey {conn.provider.name}, …
              </code>{" "}
              in the call to ask a question.
            </p>
          )}
        </div>
      </form>

      <HowItWorks providerName={conn.provider.name} />

      {/* Active meetings (live + still-joining) */}
      {active.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs uppercase tracking-widest text-stone-500">Active</h3>
          <div className="mt-3 space-y-3">
            {active.map((m) => (
              <MeetingCard key={m.id} m={m} />
            ))}
          </div>
        </div>
      )}

      {/* Past sessions */}
      <div className="mt-8">
        <h3 className="text-xs uppercase tracking-widest text-stone-500">
          Past sessions{" "}
          <span className="text-stone-400">({past.length})</span>
        </h3>
        <div className="mt-3 space-y-3">
          {past.length === 0 && (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900">
              No past sessions yet.
            </div>
          )}
          {past.map((m) => (
            <MeetingCard key={m.id} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HowItWorks({ providerName }: { providerName: string }) {
  const steps: { color: string; rotate: string; title: string; body: string }[] = [
    {
      color: "bg-emerald-300",
      rotate: "-rotate-3",
      title: "Drop a link",
      body: "Paste your Meet, Teams, or Zoom URL below.",
    },
    {
      color: "bg-amber-300",
      rotate: "rotate-2",
      title: "Bot joins",
      body: `Joins as "${providerName}" and posts a hello in chat.`,
    },
    {
      color: "bg-rose-300",
      rotate: "-rotate-2",
      title: "Ask away",
      body: `Anyone says "Hey ${providerName}, …" — answer lands in chat in seconds.`,
    },
    {
      color: "bg-emerald-300",
      rotate: "rotate-3",
      title: "Get the follow-up",
      body: "Email summary with the data questions you missed, after the call.",
    },
  ];
  return (
    <section className="mt-6 rounded-xl border border-stone-200 bg-amber-50/40 p-6 dark:border-stone-800 dark:bg-amber-950/10">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
        How it works
      </h3>
      <ol className="relative mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.color} ${s.rotate} text-sm font-bold text-stone-900 shadow-sm`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="pt-0.5">
              <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
                {s.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-stone-600 dark:text-stone-400">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlatformIcons() {
  // Official multi-color brand marks served from /public.
  const icons: { src: string; alt: string; tooltip: string }[] = [
    { src: "/meet-icon.svg", alt: "Google Meet", tooltip: "Google Meet" },
    { src: "/teams-icon.svg", alt: "Microsoft Teams", tooltip: "Microsoft Teams" },
    { src: "/zoom-icon.svg", alt: "Zoom", tooltip: "Zoom" },
  ];
  return (
    <span className="inline-flex items-center gap-2">
      {icons.map((i) => (
        <img
          key={i.alt}
          src={i.src}
          alt={i.alt}
          title={i.tooltip}
          className="h-5 w-5 object-contain"
        />
      ))}
    </span>
  );
}

function MeetingCard({ m }: { m: Meeting }) {
  const platform = detectPlatform(m.meetingUrl);
  const finished = isTerminal(m);
  const followedUp = m.questions.length > 0 || finished; // proxy until we expose followupsAt
  return (
    <a
      href={`/dashboard/${m.id}`}
      className="block rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {platform}
            </span>
            <span className="text-xs text-stone-500">
              {new Date(m.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-stone-600 dark:text-stone-400">
            {m.meetingUrl}
          </div>
        </div>
        <StatusBadge meeting={m} />
      </div>

      {m.questions.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          {m.questions.slice(0, 2).map((q) => (
            <li key={q.id} className="text-sm">
              <span className="text-stone-500">{q.askerName ?? "?"}: </span>
              <span className="text-stone-900 dark:text-stone-100">{q.question}</span>
            </li>
          ))}
          {m.questions.length > 2 && (
            <li className="text-xs text-stone-500">
              + {m.questions.length - 2} more
            </li>
          )}
        </ul>
      )}
    </a>
  );
}

function StatusBadge({ meeting }: { meeting: Meeting }) {
  const status = meeting.status;
  if (status === "in_call") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Live
      </span>
    );
  }
  if (status === "joining") {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
        Joining…
      </span>
    );
  }
  // finished — distinguish followed-up vs not based on whether we logged
  // questions during the call. Real "followed up via email" check could
  // also use followupsAt from the Meeting row once we surface it.
  if (meeting.questions.length > 0) {
    return (
      <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
        Finished · Followed up
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">
      Finished · No follow-ups
    </span>
  );
}

// ----------- secondary tabs -----------

function ToolTab({ conn }: { conn: ConnectionInfo }) {
  const isPosthog = conn.provider.id === "posthog";
  const iconSrc = isPosthog ? "/posthogicon.png" : null;
  const projectId = conn.credentials?.projectId;
  const region = conn.credentials?.host?.includes("eu.posthog.com")
    ? "EU"
    : conn.credentials?.host?.includes("us.posthog.com")
      ? "US"
      : conn.credentials?.host
        ? "Self-hosted"
        : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-4">
        {iconSrc && (
          <img
            src={iconSrc}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 bg-white p-1.5 dark:border-stone-800 dark:bg-stone-800"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {conn.provider.name}
            </h2>
            {conn.connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 2l2.39 4.84L20 8l-3.84 3.74L17.78 18 12 15.27 6.22 18l1.62-6.26L4 8l5.61-1.16L12 2z" />
                </svg>
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
                Not connected
              </span>
            )}
          </div>
          {conn.connected && (
            <div className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {conn.organizationName && (
                <span className="font-medium text-stone-900 dark:text-stone-100">
                  {conn.organizationName}
                </span>
              )}
              {conn.organizationName && conn.projectName && (
                <span className="mx-1.5 text-stone-400">·</span>
              )}
              {conn.projectName && <span>{conn.projectName}</span>}
              {projectId && (
                <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                  #{projectId}
                </span>
              )}
              {region && (
                <span className="ml-2 text-[11px] text-stone-500">{region}</span>
              )}
            </div>
          )}
        </div>
        <a
          href="/onboarding/connect"
          className="shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
        >
          {conn.connected ? "Reconnect" : `Connect ${conn.provider.name}`}
        </a>
      </div>

      {/* What this means — DataDonkey's role */}
      <div className="mt-6 rounded-lg border border-stone-100 bg-amber-50/60 p-4 dark:border-stone-800 dark:bg-amber-950/10">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
          We&apos;re just the carrier
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              Your data <strong>stays in {conn.provider.name}</strong>. DataDonkey
              never stores it — we read what&apos;s needed and forget.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              We bring the right data to <strong>where decisions happen</strong>{" "}
              — your meetings, Slack, email — not behind a login screen.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              Powered by {conn.provider.name}&apos;s official MCP server. Same
              read-only scopes as a Personal API Key — auditable in your{" "}
              {conn.provider.name} settings, revocable anytime.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function CalendarTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarConnected: false,
        calendarProvider: null,
      }),
    });
    onChange();
  }

  return (
    <Card title="Calendar">
      <p className="text-sm text-stone-700 dark:text-stone-300">
        Auto-join meetings on your calendar. We only read events with a meeting link.
      </p>
      {conn.calendarConnected ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Connected · {conn.calendarProvider}
          </span>
          <button
            onClick={disconnect}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <a
            href="/api/oauth/google/start"
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            <img src="/googlecal.png" alt="" className="h-4 w-4 object-contain" />
            Connect Google Calendar
          </a>
        </div>
      )}
    </Card>
  );
}

function SlackTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slackConnected: false,
        slackTeamName: null,
      }),
    });
    onChange();
  }

  return (
    <Card title="Slack">
      <p className="text-sm text-stone-700 dark:text-stone-300">
        DM you the post-call follow-up so you can share it with your team.
      </p>
      {conn.slackConnected ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Connected · {conn.slackTeamName ?? "workspace"}
          </span>
          <button
            onClick={disconnect}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <a
          href="/api/oauth/slack/start"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
        >
          <img src="/slackicon.png" alt="" className="h-4 w-4 object-contain" />
          Connect Slack
        </a>
      )}
    </Card>
  );
}

function PreferencesTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  const [live, setLive] = useState(conn.prefLive);
  const [followup, setFollowup] = useState(conn.prefFollowup);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLive(conn.prefLive);
    setFollowup(conn.prefFollowup);
  }, [conn.prefLive, conn.prefFollowup]);

  async function update(which: "live" | "followup") {
    const next = which === "live" ? !live : !followup;
    if (which === "live" && !next && !followup) {
      setError("At least one preference must be enabled");
      return;
    }
    if (which === "followup" && !next && !live) {
      setError("At least one preference must be enabled");
      return;
    }
    setError(null);
    if (which === "live") setLive(next);
    else setFollowup(next);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        which === "live" ? { prefLive: next } : { prefFollowup: next },
      ),
    });
    onChange();
  }

  return (
    <Card title="Preferences">
      <div className="space-y-4">
        <SmartFollowsCard
          checked={followup}
          onChange={() => update("followup")}
          providerName={conn.provider.name}
        />
        <PrefRow
          checked={live}
          onChange={() => update("live")}
          title={`"Hey ${conn.provider.name}" — answer live in calls`}
          subtitle="Reply in chat in 5–10s when someone uses the wake word."
          badge="Available, but not great yet"
        />
      </div>
      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </Card>
  );
}

function SmartFollowsCard({
  checked,
  onChange,
  providerName,
}: {
  checked: boolean;
  onChange: () => void;
  providerName: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 p-5 transition ${
        checked
          ? "border-orange-500/50 bg-gradient-to-br from-orange-50 to-amber-50 dark:border-orange-500/30 dark:from-orange-950/20 dark:to-amber-950/10"
          : "border-stone-200 dark:border-stone-800"
      }`}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onChange}
          className={`mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            checked ? "bg-orange-600" : "bg-stone-300 dark:bg-stone-700"
          }`}
          aria-pressed={checked}
        >
          <motion.span
            animate={{ x: checked ? 22 : 2 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="inline-block h-5 w-5 rounded-full bg-white shadow-md"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Smart fast follows
            </h3>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
              Recommended
            </span>
          </div>
          <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">
            DataDonkey listens to your meetings and, after, sends you a private
            briefing of the data questions that came up — answered with real
            numbers from {providerName}.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                What it&apos;s trained on
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                <li>• Spotting data questions, asked or not</li>
                <li>• Picking the right metric without being told</li>
                <li>• Strategic reasoning over your event taxonomy</li>
                <li>• Surfacing things you&apos;d miss otherwise</li>
              </ul>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                What you get
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                <li>• Email + Slack DM after each call</li>
                <li>• Bottom-line-up-front findings</li>
                <li>• Footnotes on events &amp; assumptions used</li>
                <li>• Links straight to the {providerName} chart</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white/50 p-3 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900/30 dark:text-stone-400">
            <span className="font-medium text-stone-900 dark:text-stone-100">
              Example —
            </span>{" "}
            you and your designer brainstorm a new onboarding flow. After the
            call, DataDonkey digs into your funnel data and shares an actionable
            finding: where users actually drop off today, and which step would
            move the needle most. Helping you build something people want.
          </div>
        </div>
      </div>
    </div>
  );
}

function PrefRow({
  checked,
  onChange,
  title,
  subtitle,
  badge,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex w-full items-start gap-4 rounded-lg border px-4 py-3 text-left transition ${
        checked
          ? "border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800"
          : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
      }`}
    >
      <span
        className={`mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-300 dark:bg-stone-700"
        }`}
      >
        <motion.span
          animate={{ x: checked ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="inline-block h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </span>
      <span className="flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {title}
          </span>
          {badge && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

// ----------- helpers -----------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SecondaryAction({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

function detectPlatform(url: string): "Zoom" | "Teams" | "Meet" | "unknown" {
  if (!url) return "unknown";
  if (/zoom\.us\/|zoomgov\.com\//i.test(url)) return "Zoom";
  if (/teams\.microsoft\.com\/|teams\.live\.com\//i.test(url)) return "Teams";
  if (/meet\.google\.com\//i.test(url)) return "Meet";
  return "unknown";
}

function isTerminal(m: Meeting): boolean {
  return (
    m.endedAt != null ||
    m.status === "done" ||
    m.status === "fatal" ||
    m.status === "call_ended"
  );
}
