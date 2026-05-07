"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PosthogConnectButton } from "@/components/PosthogConnectButton";

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
  regions?: { id: string; label: string; url: string }[];
}

interface ConnectionInfo {
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  provider: {
    id: string;
    name: string;
    available: boolean;
    credentialFields: CredentialField[];
    setupHint?: string;
  };
}

export default function OnboardingConnect() {
  const router = useRouter();
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connection")
      .then((r) => r.json())
      .then((j: ConnectionInfo) => {
        if (!j.signedUp) {
          router.replace("/signup");
          return;
        }
        setInfo(j);
        // Pre-fill non-secret defaults (e.g. host)
        const init: Record<string, string> = {};
        for (const f of j.provider.credentialFields) {
          if (f.placeholder && !f.secret) init[f.key] = f.placeholder;
        }
        setValues(init);
      });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: info.provider.id,
        credentials: values,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    router.push("/dashboard");
  }

  if (!info) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-6 py-16 text-stone-500">Loading…</div>
      </AppShell>
    );
  }

  const { provider } = info;
  const visibleFields = provider.credentialFields;

  return (
    <AppShell>
      <div className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Connect {provider.name}
        </h1>
        {provider.setupHint && (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            {provider.setupHint}
          </p>
        )}

        {provider.id === "posthog" && (
          <div className="mt-8 rounded-2xl border-2 border-orange-500 bg-gradient-to-br from-orange-50 to-amber-50 p-5 dark:border-orange-500/40 dark:from-orange-950/20 dark:to-amber-950/10">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Recommended
              </span>
              <span className="text-xs text-stone-600 dark:text-stone-400">
                ~5× faster than the manual key flow
              </span>
            </div>
            <h2 className="mt-3 text-base font-bold text-stone-900 dark:text-stone-100">
              Sign in with PostHog
            </h2>
            <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
              One click. Works with SSO/SAML/Google/GitHub if your org enforces
              it. Your data stays in PostHog — DataDonkey just gets a short-lived
              token.
            </p>
            <div className="mt-4">
              <PosthogConnectButton
                comingSoon={false}
                href={`/api/oauth/posthog/start?return=/onboarding/connect&region=${getRegionFromHost(values.host)}`}
              />
            </div>
            <div className="my-5 flex items-center gap-3">
              <hr className="grow border-stone-200 dark:border-stone-800" />
              <span className="text-[10px] uppercase tracking-widest text-stone-500">
                or paste a Personal API Key
              </span>
              <hr className="grow border-stone-200 dark:border-stone-800" />
            </div>
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5">
          {visibleFields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                {f.label}
              </span>
              {f.regions ? (
                <RegionPicker
                  field={f}
                  value={values[f.key] ?? f.placeholder ?? ""}
                  onChange={(v) => setValues((vs) => ({ ...vs, [f.key]: v }))}
                />
              ) : (
                <input
                  type={f.secret ? "password" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="mt-1.5 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                />
              )}
              {f.helpText && (
                <span
                  className="mt-1.5 block text-xs text-stone-500"
                  dangerouslySetInnerHTML={{ __html: f.helpText }}
                />
              )}
            </label>
          ))}

          {!provider.available && (
            <div className="rounded-md bg-amber-50 px-3 py-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Heads up: live Q&amp;A for {provider.name} isn&apos;t available yet
              — its MCP server hasn&apos;t shipped. We&apos;ll save your
              credentials and turn things on the moment it&apos;s available.
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {busy ? "Connecting…" : "Connect & continue"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

function RegionPicker({
  field,
  value,
  onChange,
}: {
  field: CredentialField;
  value: string;
  onChange: (v: string) => void;
}) {
  const regions = field.regions ?? [];
  const matched = regions.find((r) => r.url === value);
  const initial = matched?.id ?? (value && value !== field.placeholder ? "custom" : regions[0]?.id ?? "us");
  const [selected, setSelected] = useState<string>(initial);
  const isCustom = selected === "custom";

  function pick(id: string) {
    setSelected(id);
    const r = regions.find((rr) => rr.id === id);
    if (r && r.id !== "custom") onChange(r.url);
    else if (r && r.id === "custom") onChange("");
  }

  return (
    <div className="mt-1.5 space-y-2">
      <select
        value={selected}
        onChange={(e) => pick(e.target.value)}
        className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://your-posthog.example.com"
          className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      )}
    </div>
  );
}

function getRegionFromHost(host: string | undefined): "us" | "eu" {
  if (!host) return "us";
  if (host.includes("eu.posthog.com")) return "eu";
  return "us";
}
