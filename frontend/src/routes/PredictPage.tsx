import { useEffect, useRef, useState } from "react";

import { predictTags } from "../lib/api";

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PredictPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  async function handlePredict() {
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await predictTags(formData);
      setResult(response.wrinkles);
    } catch (err) {
      if (err instanceof Response && err.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (err instanceof Response && err.status === 403) {
        setError("У вас нет доступа к magic-инструменту.");
      } else {
        setError("Не удалось выполнить предсказание.");
      }
    } finally {
      setLoading(false);
    }
  }

  function resetState() {
    setFile(null);
    setPreviewUrl("");
    setResult(null);
    setError("");
    setLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <main className="space-y-6">
      <section className="panel overflow-hidden px-6 py-6 sm:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(244,114,182,0.18),_transparent_30%)]" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Magic</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Быстрый анализ изображения
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Загрузите кадр и получите предсказанные теги.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Режим</p>
              <p className="mt-2 text-lg font-semibold text-ink">Multi-label prediction</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Вывод</p>
              <p className="mt-2 text-lg font-semibold text-ink">Набор вероятных тегов</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="panel px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Input</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Изображение для анализа</h2>
            </div>
            {file ? (
              <button
                type="button"
                onClick={resetState}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
              >
                Сбросить
              </button>
            ) : null}
          </div>

          <label className="mt-6 block cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              className="hidden"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setResult(null);
                setError("");
              }}
            />
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-[linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(241,245,249,0.96))] px-6 py-8 transition hover:border-sky-300 hover:bg-white">
              {previewUrl ? (
                <div className="space-y-5">
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950/95 p-4">
                    <img
                      src={previewUrl}
                      alt={file?.name ?? "preview"}
                      className="mx-auto max-h-[420px] rounded-[20px] object-contain shadow-[0_20px_60px_rgba(15,23,42,0.35)]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{file?.name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {file ? formatFileSize(file.size) : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-500">
                      Готово к анализу
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-sky-100 text-sky-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-8 w-8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0-4 4m4-4 4 4M4 16.5v1.25A2.25 2.25 0 0 0 6.25 20h11.5A2.25 2.25 0 0 0 20 17.75V16.5" />
                    </svg>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-ink">Выбери изображение</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    JPG, JPEG или PNG. После выбора покажем превью и дадим запустить предсказание.
                  </p>
                  <div className="mt-5 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
                    Открыть файл
                  </div>
                </div>
              )}
            </div>
          </label>

          <div className="mt-7 flex flex-col items-center gap-3">
            <div className="magic-cta-shell">
              <button
                type="button"
                disabled={!file || loading}
                onClick={() => void handlePredict()}
                className="magic-cta"
              >
                <span className="magic-cta__spark" />
                <span className="magic-cta__label">
                  {loading ? "Анализируем..." : "Запустить Magic"}
                </span>
                <span className="magic-cta__spark" />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
                Модель обрабатывает изображение
              </div>
            ) : (
              <p className="text-center text-sm text-slate-500">
                Кнопка активируется после выбора изображения.
              </p>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="panel px-6 py-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Output</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Результат модели</h2>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {!error && !result && !loading ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Пока здесь ничего нет. Загрузи изображение и запусти анализ.
              </div>
            ) : null}

            {!error && result ? (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {result.length ? (
                    result.map((tag, index) => (
                      <span
                        key={tag}
                        className="rounded-full bg-[linear-gradient(135deg,_#0f172a,_#9333ea)] px-3 py-2 text-sm font-semibold text-white shadow-soft"
                        style={{ animationDelay: `${index * 80}ms` }}
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
                      Морщины не обнаружены
                    </span>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {result.length ? `Найдено тегов: ${result.length}` : "Совпадений не найдено"}
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel px-6 py-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Подсказка</p>
            <p className="mt-3 text-sm text-slate-600">
              Лучше всего работают одиночные фронтальные кадры лица.
            </p>
          </section>
        </aside>
      </section>
    </main>
  );
}
