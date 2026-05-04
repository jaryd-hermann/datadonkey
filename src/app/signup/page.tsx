"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AppShell } from "@/components/AppShell";

type StepId = "auth" | "tool" | "preferences" | "calendar" | "slack";

const STEPS: { id: StepId; label: string }[] = [
  { id: "auth", label: "Account" },
  { id: "tool", label: "Data tool" },
  { id: "preferences", label: "Preferences" },
  { id: "calendar", label: "Calendar" },
  { id: "slack", label: "Slack" },
];

const TOOLS = [
  { id: "posthog", name: "PostHog", recommended: true, hasOAuth: true, oauthLabel: "Continue with PostHog" },
  { id: "mixpanel", name: "Mixpanel", recommended: false, hasOAuth: true, oauthLabel: "Continue with Mixpanel" },
  { id: "amplitude", name: "Amplitude", recommended: false, hasOAuth: true, oauthLabel: "Continue with Amplitude" },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
  required?: boolean;
}

interface ProviderShape {
  id: string;
  name: string;
  available: boolean;
  hasOAuth: boolean;
  oauthLabel?: string;
  credentialFields: CredentialField[];
  setupHint?: string;
}

export default function Signup() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const step = STEPS[stepIdx].id;

  // Step 1 state
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");

  // Step 2 state
  const [tool, setTool] = useState<ToolId>("posthog");
  const [provider, setProvider] = useState<ProviderShape | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});

  // Step 3 state
  const [prefLive, setPrefLive] = useState(true);
  const [prefFollowup, setPrefFollowup] = useState(true);

  // Step 4 state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarProvider, setCalendarProvider] = useState<"google" | "microsoft" | null>(null);

  // Step 5 state
  const [slackConnected, setSlackConnected] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate provider config when tool changes (so we know the credential
  // fields). Doesn't require backend if we encode the shape locally.
  useEffect(() => {
    fetch("/api/connection")
      .then((r) => r.json())
      .then((j) => {
        // Set provider shape based on the most recent backend value when we
        // first land on the tool step, not eagerly on mount, to avoid
        // overriding the user's selection.
        if (j.provider) setProvider(j.provider);
      })
      .catch(() => {});
  }, []);

  // When tool changes, fetch its provider shape from server. We do this by
  // POSTing the new tool to the signup endpoint (it persists name/co + tool
  // from step 1), then GETting the connection to read the provider config.
  async function loadProviderForTool(t: ToolId) {
    // Quietly persist current tool selection by hitting POST again. The
    // server's POST validates name+company; we only call this once they've
    // already submitted those.
    if (!name || !company) return;
    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: name,
        userCompany: company,
        userEmail: email || undefined,
        provider: t,
      }),
    });
    const r = await fetch("/api/connection");
    const j = await r.json();
    setProvider(j.provider);

    // Pre-fill placeholders for non-secret fields (e.g. host).
    const init: Record<string, string> = {};
    for (const f of j.provider.credentialFields as CredentialField[]) {
      if (f.placeholder && !f.secret && !f.required) {
        init[f.key] = f.placeholder;
      }
    }
    setCredValues(init);
  }

  function go(delta: number) {
    const next = Math.max(0, Math.min(STEPS.length - 1, stepIdx + delta));
    if (next === stepIdx) return;
    setDirection(delta > 0 ? 1 : -1);
    setStepIdx(next);
    setError(null);
  }

  // ---- step submission handlers ----

  async function submitAuth(method: string) {
    setError(null);
    if (authMode === "signin") {
      // Mock: anyone with an email goes to dashboard.
      router.push("/dashboard");
      return;
    }
    if (!name.trim() || !company.trim()) {
      setError("Name and company are required");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: name.trim(),
        userCompany: company.trim(),
        userEmail: email.trim() || undefined,
        provider: tool,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    console.log(`(mock) signed up via ${method}`);
    await loadProviderForTool(tool);
    go(1);
  }

  async function submitTool(method?: string) {
    setError(null);
    if (!provider) {
      // First time on this step; load provider config and reveal fields.
      await loadProviderForTool(tool);
      return;
    }
    // If the user clicked the SSO button, treat it like submission with empty
    // creds for now — mock OAuth — and skip credential validation. They can
    // fill in real creds later from the dashboard.
    if (method === "sso") {
      go(1);
      return;
    }
    // Otherwise validate credentials via PUT
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: tool, credentials: credValues }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? "Failed");
      return;
    }
    go(1);
  }

  async function submitPreferences() {
    setError(null);
    if (!prefLive && !prefFollowup) {
      setError("Please enable at least one mode");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefLive, prefFollowup }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    go(1);
  }

  async function submitCalendar(skip = false) {
    setError(null);
    setBusy(true);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarConnected: !skip && calendarConnected,
        calendarProvider: !skip && calendarConnected ? calendarProvider : null,
      }),
    });
    setBusy(false);
    go(1);
  }

  async function submitSlack(skip = false) {
    setError(null);
    setBusy(true);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slackConnected: !skip && slackConnected,
        slackTeamName: !skip && slackConnected ? "Demo workspace" : null,
      }),
    });
    setBusy(false);
    router.push("/dashboard");
  }

  // ----------- UI -----------

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Step indicator */}
        <ProgressDots stepIdx={stepIdx} />

        <div className="mt-10 grid gap-12 md:grid-cols-2">
          {/* LEFT: action */}
          <div className="min-h-[420px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                initial={{ opacity: 0, x: direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {step === "auth" && (
                  <AuthStep
                    authMode={authMode}
                    setAuthMode={setAuthMode}
                    name={name}
                    setName={setName}
                    company={company}
                    setCompany={setCompany}
                    email={email}
                    setEmail={setEmail}
                    tool={tool}
                    onContinue={submitAuth}
                    error={error}
                    busy={busy}
                  />
                )}
                {step === "tool" && (
                  <ToolStep
                    tool={tool}
                    setTool={(t) => {
                      setTool(t);
                      // Eagerly fetch provider shape so fields appear.
                      loadProviderForTool(t);
                    }}
                    provider={provider}
                    credValues={credValues}
                    setCredValues={setCredValues}
                    onContinue={() => submitTool()}
                    onSso={() => submitTool("sso")}
                    error={error}
                    busy={busy}
                  />
                )}
                {step === "preferences" && (
                  <PreferencesStep
                    toolName={provider?.name ?? "PostHog"}
                    prefLive={prefLive}
                    setPrefLive={setPrefLive}
                    prefFollowup={prefFollowup}
                    setPrefFollowup={setPrefFollowup}
                    onContinue={submitPreferences}
                    error={error}
                    busy={busy}
                  />
                )}
                {step === "calendar" && (
                  <CalendarStep
                    connected={calendarConnected}
                    provider={calendarProvider}
                    onConnect={(p) => {
                      setCalendarProvider(p);
                      setCalendarConnected(true);
                    }}
                    onContinue={() => submitCalendar(false)}
                    onSkip={() => submitCalendar(true)}
                    busy={busy}
                  />
                )}
                {step === "slack" && (
                  <SlackStep
                    connected={slackConnected}
                    onConnect={() => setSlackConnected(true)}
                    onContinue={() => submitSlack(false)}
                    onSkip={() => submitSlack(true)}
                    busy={busy}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Back button */}
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => go(-1)}
                className="mt-8 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
              >
                ← back
              </button>
            )}
          </div>

          {/* RIGHT: marketing */}
          <div className="hidden md:block">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="sticky top-10 rounded-2xl border border-stone-200 bg-gradient-to-b from-amber-50/40 to-stone-50 p-8 dark:border-stone-800 dark:from-amber-900/10 dark:to-stone-900/40"
              >
                <Marketing step={step} toolName={provider?.name ?? "PostHog"} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ProgressDots({ stepIdx }: { stepIdx: number }) {
  return (
    <div className="flex items-center gap-3">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-3">
          <motion.div
            animate={{
              scale: i === stepIdx ? 1.2 : 1,
              backgroundColor:
                i <= stepIdx ? "rgb(28 25 23)" : "rgb(214 211 209)",
            }}
            transition={{ duration: 0.2 }}
            className="h-2 w-2 rounded-full"
          />
          <span
            className={`text-xs uppercase tracking-widest transition ${
              i === stepIdx
                ? "text-stone-900 dark:text-stone-100"
                : "text-stone-400"
            }`}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <div className="h-px w-6 bg-stone-200 dark:bg-stone-800" />
          )}
        </div>
      ))}
    </div>
  );
}

function AuthStep(props: {
  authMode: "signup" | "signin";
  setAuthMode: (v: "signup" | "signin") => void;
  name: string;
  setName: (v: string) => void;
  company: string;
  setCompany: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  tool: ToolId;
  onContinue: (method: string) => void;
  error: string | null;
  busy: boolean;
}) {
  const isSignup = props.authMode === "signup";
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        {isSignup ? "Create your account" : "Welcome back"}
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => props.setAuthMode(isSignup ? "signin" : "signup")}
          className="font-medium text-stone-900 underline dark:text-stone-100"
        >
          {isSignup ? "Sign in" : "Sign up"}
        </button>
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onContinue("email");
        }}
        className="mt-8 space-y-4"
      >
        {isSignup && (
          <>
            <Field label="Name">
              <Input
                required
                value={props.name}
                onChange={(e) => props.setName(e.target.value)}
                placeholder="Alex Rivera"
              />
            </Field>
            <Field label="Company">
              <Input
                required
                value={props.company}
                onChange={(e) => props.setCompany(e.target.value)}
                placeholder="Acme"
              />
            </Field>
          </>
        )}
        <Field label="Work email">
          <Input
            type="email"
            required={!isSignup}
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
            placeholder="alex@acme.com"
          />
        </Field>

        {props.error && <ErrorBox>{props.error}</ErrorBox>}

        <PrimaryButton type="submit" disabled={props.busy}>
          {props.busy ? "Continuing…" : isSignup ? "Continue with email" : "Sign in"}
        </PrimaryButton>

        <div className="my-3 flex items-center gap-3">
          <hr className="grow border-stone-200 dark:border-stone-800" />
          <span className="text-xs uppercase tracking-widest text-stone-400">or</span>
          <hr className="grow border-stone-200 dark:border-stone-800" />
        </div>

        <SecondaryButton type="button" onClick={() => props.onContinue("google")}>
          🔑 Continue with Google
        </SecondaryButton>
      </form>
    </div>
  );
}

function ToolStep(props: {
  tool: ToolId;
  setTool: (t: ToolId) => void;
  provider: ProviderShape | null;
  credValues: Record<string, string>;
  setCredValues: (fn: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  onContinue: () => void;
  onSso: () => void;
  error: string | null;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        Pick your data tool
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        We&apos;ll connect through their MCP. Your data stays where it is.
      </p>

      <div className="mt-6 space-y-3">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => props.setTool(t.id)}
            className={`group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
              props.tool === t.id
                ? "border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800"
                : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium">{t.name}</span>
              {t.recommended && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  Recommended
                </span>
              )}
            </span>
            <span className="text-stone-400">
              {props.tool === t.id ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {props.provider && (
          <motion.div
            key={props.provider.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-6 overflow-hidden"
          >
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
              <div className="mb-3 text-xs uppercase tracking-widest text-stone-500">
                Connect {props.provider.name}
              </div>
              <div className="space-y-3">
                {props.provider.credentialFields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Input
                      type={f.secret ? "password" : "text"}
                      placeholder={f.placeholder}
                      value={props.credValues[f.key] ?? ""}
                      onChange={(e) =>
                        props.setCredValues((prev: Record<string, string>) => ({
                          ...prev,
                          [f.key]: e.target.value,
                        }))
                      }
                    />
                    {f.helpText && (
                      <p className="mt-1 text-xs text-stone-500">{f.helpText}</p>
                    )}
                  </Field>
                ))}
              </div>

              {props.error && <ErrorBox>{props.error}</ErrorBox>}

              {props.provider.hasOAuth && props.provider.oauthLabel && (
                <SecondaryButton
                  type="button"
                  onClick={props.onSso}
                  className="mt-4"
                >
                  🔐 {props.provider.oauthLabel}
                </SecondaryButton>
              )}
              <PrimaryButton
                type="button"
                disabled={props.busy}
                onClick={props.onContinue}
                className="mt-2"
              >
                {props.busy ? "Validating…" : "Connect & continue"}
              </PrimaryButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PreferencesStep(props: {
  toolName: string;
  prefLive: boolean;
  setPrefLive: (v: boolean) => void;
  prefFollowup: boolean;
  setPrefFollowup: (v: boolean) => void;
  onContinue: () => void;
  error: string | null;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">How should I work?</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Pick at least one. Both default on.
      </p>
      <div className="mt-6 space-y-3">
        <Toggle
          checked={props.prefLive}
          onChange={() => props.setPrefLive(!props.prefLive)}
          title={`"Hey ${props.toolName}" — answer live in calls`}
          subtitle={`Anyone in the meeting can ask. Replies in chat in 5–10s.`}
        />
        <Toggle
          checked={props.prefFollowup}
          onChange={() => props.setPrefFollowup(!props.prefFollowup)}
          title="Smart fast follows"
          subtitle="After each call, I read the transcript, surface data questions, and email everyone the answers."
        />
      </div>

      {props.error && <ErrorBox>{props.error}</ErrorBox>}

      <PrimaryButton
        type="button"
        onClick={props.onContinue}
        disabled={props.busy}
        className="mt-6"
      >
        {props.busy ? "Saving…" : "Continue"}
      </PrimaryButton>
    </div>
  );
}

function CalendarStep(props: {
  connected: boolean;
  provider: "google" | "microsoft" | null;
  onConnect: (p: "google" | "microsoft") => void;
  onContinue: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Connect your calendar</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        So DataDonkey auto-joins meetings on your calendar with a video link.
      </p>

      <div className="mt-6 space-y-3">
        <ConnectButton
          connected={props.connected && props.provider === "google"}
          onClick={() => props.onConnect("google")}
        >
          📅 Connect Google Calendar
        </ConnectButton>
        <ConnectButton
          connected={props.connected && props.provider === "microsoft"}
          onClick={() => props.onConnect("microsoft")}
        >
          📅 Connect Outlook / Microsoft Calendar
        </ConnectButton>
      </div>

      <p className="mt-4 text-xs text-stone-500">
        We only read events with a meeting link. We never read your inbox.
      </p>

      <div className="mt-6 flex gap-3">
        <PrimaryButton onClick={props.onContinue} disabled={props.busy}>
          {props.connected ? "Continue" : "Continue without calendar"}
        </PrimaryButton>
        {!props.connected && (
          <button
            type="button"
            onClick={props.onSkip}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function SlackStep(props: {
  connected: boolean;
  onConnect: () => void;
  onContinue: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Connect Slack</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Optional. We&apos;ll DM you the post-call follow-up so you can share it.
      </p>

      <div className="mt-6">
        <ConnectButton connected={props.connected} onClick={props.onConnect}>
          💬 Connect Slack
        </ConnectButton>
      </div>

      <div className="mt-6 flex gap-3">
        <PrimaryButton onClick={props.onContinue} disabled={props.busy}>
          {props.connected ? "Finish & open dashboard" : "Finish without Slack"}
        </PrimaryButton>
        {!props.connected && (
          <button
            type="button"
            onClick={props.onSkip}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function Marketing({ step, toolName }: { step: StepId; toolName: string }) {
  if (step === "auth") {
    return (
      <Copy
        kicker="Welcome"
        title="Your data analyst on every call."
        body={[
          "Stop alt-tabbing to look up numbers mid-meeting. Stop forgetting follow-ups.",
          `Say "Hey ${toolName}" in a call and the answer lands in chat in seconds. After the call, you get an email with the data points you missed.`,
        ]}
      />
    );
  }
  if (step === "tool") {
    return (
      <Copy
        kicker="Why we ask"
        title="Bring your own analytics."
        body={[
          "Your data lives in PostHog, Mixpanel, or Amplitude. We pass questions through their MCP servers — your data never copies into us.",
          "Need a Personal API key? PostHog → Settings → Personal API keys. Read scopes for query, insight, dashboard, feature flags, experiments are enough.",
        ]}
      />
    );
  }
  if (step === "preferences") {
    return (
      <Copy
        kicker="Two superpowers"
        title="Live answers + smart follow-ups."
        body={[
          "Live answers handle the moment-of-truth in calls. Smart follow-ups handle everything you forgot to ask.",
          "Most teams keep both on. Pick one if you only want the bot in some places.",
        ]}
      />
    );
  }
  if (step === "calendar") {
    return (
      <Copy
        kicker="Auto-join"
        title="Joins itself, when you want it."
        body={[
          "DataDonkey reads your calendar to know when to join. We only see events with a meeting link.",
          "You can always paste a meeting URL manually from the dashboard.",
        ]}
      />
    );
  }
  return (
    <Copy
      kicker="Optional"
      title="Slack is where most teams want this."
      body={[
        "Post-call follow-ups go to a Slack DM, ready for you to forward to the team.",
        "Skip this for now — you can connect later.",
      ]}
    />
  );
}

function Copy({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-300">
        {kicker}
      </div>
      <h3 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        {title}
      </h3>
      {body.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
          {p}
        </p>
      ))}
    </div>
  );
}

// ---- shared UI primitives ----

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${
        props.className ?? ""
      }`}
    />
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 ${
        props.className ?? ""
      }`}
    />
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${
        props.className ?? ""
      }`}
    />
  );
}

function ConnectButton({
  connected,
  onClick,
  children,
}: {
  connected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md border px-4 py-3 text-sm font-medium transition ${
        connected
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-100"
          : "border-stone-300 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
      }`}
    >
      <span>{children}</span>
      <span>{connected ? "✓ connected" : "→"}</span>
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
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
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm`}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
      {children}
    </div>
  );
}
