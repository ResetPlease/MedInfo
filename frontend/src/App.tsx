import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

import { getCurrentUser, logout } from "./lib/api";
import type { CurrentUser } from "./lib/api";
import { AppShell } from "./components/AppShell";
import { AdminPage } from "./routes/AdminPage";
import { ImageDetailPage } from "./routes/ImageDetailPage";
import { ImageEditorPage } from "./routes/ImageEditorPage";
import { IndexPage } from "./routes/IndexPage";
import { LoginPage } from "./routes/LoginPage";
import { PredictPage } from "./routes/PredictPage";
import { StatsPage } from "./routes/StatsPage";
import { UploadPage } from "./routes/UploadPage";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="panel flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        <div className="h-14 w-14 rounded-2xl border border-sky-200 bg-sky-100/80 p-3 text-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 4v16M5 19h14" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
            Wrinkles
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Подготавливаем рабочее пространство</h1>
          <p className="mt-2 text-sm text-slate-500">
            Загружаем профиль и конфигурацию экрана.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="panel w-full max-w-md p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка инициализации</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть консоль</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        <button
          className="mt-6 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accentDark"
          onClick={() => window.location.reload()}
        >
          Повторить
        </button>
      </div>
    </div>
  );
}

function LegacyAdminUserRedirect() {
  const params = useParams();
  const userId = params.userId;

  if (!userId) {
    return <Navigate to="/admin?tab=users" replace />;
  }

  return <Navigate to={`/admin?tab=users&user=${userId}`} replace />;
}

export function App() {
  const location = useLocation();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const isLoginRoute = location.pathname === "/login";

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await getCurrentUser(controller.signal);
        setUser(response.user);
        setStatus("ready");
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          setUser(null);
          setStatus("ready");
          return;
        }

        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, []);

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "error") {
    return <ErrorScreen message={error || "Не удалось получить профиль пользователя"} />;
  }

  if (isLoginRoute) {
    return <LoginPage authenticated={Boolean(user)} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell
      user={user}
      onLogout={async () => {
        await logout();
        window.location.assign("/login");
      }}
    >
      <Routes>
        <Route path="/" element={<IndexPage currentUser={user} />} />
        <Route path="/admin" element={<AdminPage currentUser={user} />} />
        <Route path="/admin/stats" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/users" element={<Navigate to="/admin?tab=users" replace />} />
        <Route path="/admin/tags" element={<Navigate to="/admin?tab=tags" replace />} />
        <Route path="/admin/users/:userId/stats" element={<LegacyAdminUserRedirect />} />
        <Route path="/upload" element={<UploadPage currentUser={user} />} />
        <Route path="/predict" element={<PredictPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/image/:imageId" element={<ImageDetailPage currentUser={user} />} />
        <Route path="/image/:imageId/editor" element={<ImageEditorPage currentUser={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
