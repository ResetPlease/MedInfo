import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";

import { login } from "../lib/api";

type LoginPageProps = {
  authenticated: boolean;
};

const wordmarkPaths = [
  "M18 28 L40 168 L76 86 L112 168 L134 28",
  "M190 168 L190 28 M190 28 L252 28 Q294 28 294 64 Q294 100 252 100 L190 100 M248 100 L304 168",
  "M356 28 L420 28 M388 28 L388 168 M356 168 L420 168",
  "M476 168 L476 28 L574 168 L574 28",
  "M634 168 L634 28 M634 98 L716 28 M634 98 L722 168",
  "M780 28 L780 168 L858 168",
  "M918 28 L918 168 M918 28 L1000 28 M918 98 L986 98 M918 168 L1000 168",
  "M1116 44 Q1090 24 1052 28 Q1014 32 1018 74 Q1022 104 1070 110 Q1118 116 1122 144 Q1126 172 1088 174 Q1050 176 1016 150",
];

export function LoginPage({ authenticated }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (authenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await login({
        username,
        password,
      });
      window.location.assign("/");
    } catch (err) {
      if (err instanceof Response) {
        const payload = await err.json().catch(() => null);
        setError(payload?.detail ?? "Не удалось выполнить вход");
      } else {
        setError("Не удалось выполнить вход");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-surface px-6 py-10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.1),_transparent_30%),linear-gradient(180deg,_#f6faff_0%,_#eef4fb_100%)]" />

      <section className="relative z-10 flex w-full max-w-5xl -translate-y-8 flex-col items-center gap-8 md:-translate-y-10">
        <div className="w-full max-w-[860px] px-2">
          <svg
            viewBox="0 0 1148 196"
            className="login-wordmark-stroke w-full"
            aria-label="Wrinkles"
            role="img"
          >
            <defs>
              <linearGradient id="wrinklesStrokeGradient" x1="0%" x2="100%" y1="50%" y2="50%">
                <stop offset="0%" stopColor="#0284c7" />
                <stop offset="30%" stopColor="#0ea5e9" />
                <stop offset="66%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
            </defs>

            {wordmarkPaths.map((path, index) => (
              <path
                key={`glow-${index}`}
                d={path}
                pathLength={100}
                className="login-wordmark-stroke__path login-wordmark-stroke__path--glow"
                style={{ ["--delay" as string]: `${index * 0.22}s` }}
              />
            ))}

            {wordmarkPaths.map((path, index) => (
              <path
                key={`main-${index}`}
                d={path}
                pathLength={100}
                className="login-wordmark-stroke__path"
                style={{ ["--delay" as string]: `${index * 0.22}s` }}
              />
            ))}
          </svg>
        </div>

        <section className="panel w-full max-w-sm overflow-hidden px-6 py-6 sm:px-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(79,70,229,0.08),_transparent_26%)]" />

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">Логин</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl border border-sky-300/30 bg-[linear-gradient(135deg,_#020617_0%,_#0f172a_32%,_#075985_68%,_#0ea5e9_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(14,165,233,0.18)] transition hover:scale-[1.01] hover:shadow-[0_20px_42px_rgba(14,165,233,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Входим..." : "Войти"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
