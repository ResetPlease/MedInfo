import { FormEvent, useEffect, useMemo, useState } from "react";

import { getTags, predictTags, uploadImage } from "../lib/api";
import type { CurrentUser } from "../lib/api";

type UploadPageProps = {
  currentUser: CurrentUser;
};

export function UploadPage({ currentUser }: UploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await getTags(controller.signal);
        setTags(response.items);
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setError("Не удалось загрузить список тегов");
      } finally {
        setLoadingTags(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const previewUrl = useMemo(() => {
    if (!file) {
      return "";
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function toggleTag(tag: string) {
    setSelectedTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag],
    );
  }

  async function handlePredict() {
    if (!file) {
      return;
    }

    setPredicting(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await predictTags(formData);
      setSelectedTags((currentTags) => {
        const next = [...currentTags];

        for (const wrinkle of response.wrinkles) {
          if (!next.includes(wrinkle)) {
            next.push(wrinkle);
          }
        }

        return next;
      });
    } catch (err) {
      if (err instanceof Response && err.status === 403) {
        setError("Предсказание доступно только администратору");
      } else {
        setError("Не удалось получить предсказание");
      }
    } finally {
      setPredicting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Нужно выбрать изображение");
      return;
    }

    if (!name.trim()) {
      setError("Нужно указать название изображения");
      return;
    }

    if (!selectedTags.length) {
      setError("Выбери хотя бы один тег");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim());
      selectedTags.forEach((tag) => formData.append("tags", tag));

      const response = await uploadImage(formData);
      window.location.assign(response.redirect_url);
    } catch (err) {
      if (err instanceof Response) {
        try {
          const data = (await err.json()) as { detail?: string };
          setError(data.detail ?? "Не удалось загрузить изображение");
        } catch {
          setError("Не удалось загрузить изображение");
        }
      } else {
        setError("Не удалось загрузить изображение");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!currentUser.permissions.at_least_worker) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Доступ ограничен</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Загрузка недоступна</h1>
        <p className="mt-3 text-sm text-slate-600">
          Для загрузки изображений нужна роль не ниже `worker`.
        </p>
      </section>
    );
  }

  return (
    <main className="space-y-6">
      <section className="panel px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Новый материал</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Загрузка изображения
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Тегов</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{tags.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Роль</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{currentUser.role}</p>
            </div>
          </div>
        </div>
      </section>

      <form className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]" onSubmit={handleSubmit}>
        <section className="panel px-6 py-6">
          <h2 className="text-lg font-semibold text-ink">Файл</h2>
          <p className="mt-2 text-sm text-slate-500">
            Поддерживаются `.jpg`, `.jpeg`, `.png`.
          </p>

          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-sky-300 hover:bg-sky-50/60">
            <input
              type="file"
              accept=".jpg,.jpeg,.png"
              className="hidden"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                if (nextFile) {
                  setName(nextFile.name.replace(/\.[^.]+$/, ""));
                }
              }}
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-accent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
              </svg>
            </div>
            <p className="mt-4 text-base font-semibold text-ink">
              {file ? file.name : "Выбери изображение"}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Перетащить файл пока нельзя, но можно быстро выбрать его с диска.
            </p>
          </label>

          <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="max-h-[420px] w-full object-contain" />
            ) : (
              <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-sm text-slate-400">
                Превью появится после выбора изображения
              </div>
            )}
          </div>
        </section>

        <section className="panel px-6 py-6">
          <h2 className="text-lg font-semibold text-ink">Параметры</h2>

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-600">Название</label>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
            </div>

            {currentUser.permissions.is_admin ? (
              <div className="rounded-[24px] border border-sky-100 bg-[linear-gradient(145deg,rgba(15,124,255,0.08),rgba(117,213,255,0.05))] p-4">
                <p className="text-sm font-semibold text-ink">Подсказка от модели</p>
                <p className="mt-2 text-sm text-slate-500">
                  Можно заранее предложить теги на основе изображения.
                </p>
                <button
                  type="button"
                  disabled={!file || predicting}
                  onClick={() => void handlePredict()}
                  className="mt-4 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accentDark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {predicting ? "Предсказываем..." : "Предсказать морщины"}
                </button>
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-slate-600">Теги</label>
                <span className="text-sm text-slate-400">{selectedTags.length} выбрано</span>
              </div>

              {loadingTags ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Загружаем теги...
                </div>
              ) : (
                <div className="flex max-h-[360px] flex-wrap gap-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {tags.map((tag) => {
                    const selected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                          selected
                            ? "bg-slate-950 text-white"
                            : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedTags.length ? (
              <div className="flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-sm font-medium text-sky-800 ring-1 ring-inset ring-sky-200"
                  >
                    <span>{tag}</span>
                    <span className="text-xs leading-none">×</span>
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <a
                href="/"
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
              >
                Отмена
              </a>
              <button
                type="submit"
                disabled={submitting || loadingTags}
                className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Загружаем..." : "Загрузить изображение"}
              </button>
            </div>
          </div>
        </section>
      </form>
    </main>
  );
}
