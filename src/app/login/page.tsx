"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  function go(method: string) {
    console.log(`(mock) signed in via ${method}`);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-dvh bg-stone-50 dark:bg-stone-950">
      <div className="mx-auto max-w-md px-6 py-16">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
          <span>🫏</span>
          <span>datadonkey</span>
        </a>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Welcome back.
        </h1>

        <div className="mt-10 grid gap-2">
          <button
            onClick={() => go("google")}
            className="flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            <span>🔑</span>
            <span>Continue with Google</span>
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <hr className="grow border-stone-200 dark:border-stone-800" />
          <span className="text-xs uppercase tracking-widest text-stone-400">
            or email
          </span>
          <hr className="grow border-stone-200 dark:border-stone-800" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            go("email");
          }}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alex@acme.com"
            className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
          <button
            type="submit"
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            Continue
          </button>
        </form>

        <p className="mt-8 text-sm text-stone-500">
          New here?{" "}
          <a href="/signup" className="underline">
            Become a design partner
          </a>
        </p>

        <p className="mt-2 text-xs text-stone-500">
          Mock auth for the prototype.
        </p>
      </div>
    </div>
  );
}
