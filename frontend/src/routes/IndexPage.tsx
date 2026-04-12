import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ImageCard } from "../components/ImageCard";
import { getImages } from "../lib/api";
import type { CurrentUser, ImagesResponse } from "../lib/api";
import { imageStatusOptions } from "../lib/imageStatus";

type IndexPageProps = {
  currentUser: CurrentUser;
};

type RecognizedFilter = {
  text: string;
  tone: string;
};

type FilterPattern = {
  source: string;
  tone: string;
};

const quotedFilterValue = `(?:\"[^\"]+\"|(?!\")[^\\s]+)`;

function createDefaultParams(searchParams: URLSearchParams) {
  const next = new URLSearchParams(searchParams);

  if (!next.get("page")) {
    next.set("page", "1");
  }

  if (!next.get("limit")) {
    next.set("limit", "12");
  }

  return next;
}

function getFilterPatterns(requireTrailingWhitespace: boolean): FilterPattern[] {
  const suffix = requireTrailingWhitespace ? "(?=\\s)" : "(?=\\s|$)";

  return [
    { source: `id\\s*[<>=]{1,2}\\s*\\d+${suffix}|id:\\d+${suffix}`, tone: "text-violet-700 bg-violet-100/90 ring-1 ring-violet-200" },
    { source: `count\\s*[<>=]{1,2}\\s*\\d+${suffix}`, tone: "text-amber-700 bg-amber-100/90 ring-1 ring-amber-200" },
    { source: `tag:${quotedFilterValue}${suffix}`, tone: "text-cyan-700 bg-cyan-100/90 ring-1 ring-cyan-200" },
    { source: `(?:assignee|assigned|user):${quotedFilterValue}${suffix}`, tone: "text-emerald-700 bg-emerald-100/90 ring-1 ring-emerald-200" },
  ];
}

function buildRecognizedFilters(value: string): RecognizedFilter[] {
  if (!value) {
    return [];
  }

  const patterns = getFilterPatterns(false);

  const matches: Array<RecognizedFilter & { start: number; end: number }> = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, "gi");
    for (const match of value.matchAll(regex)) {
      const start = match.index;
      const text = match[0];

      if (start === undefined || !text) {
        continue;
      }

      matches.push({
        text,
        tone: pattern.tone,
        start,
        end: start + text.length,
      });
    }
  }

  matches.sort((left, right) => left.start - right.start);

  const filteredMatches: Array<RecognizedFilter & { start: number; end: number }> = [];
  for (const match of matches) {
    const last = filteredMatches.at(-1);
    if (!last || match.start >= last.end) {
      filteredMatches.push(match);
    }
  }

  return filteredMatches.map((match) => ({
    text: match.text,
    tone: match.tone,
  }));
}

function normalizeLooseSearchText(value: string) {
  if (!value) {
    return "";
  }

  const hasTrailingWhitespace = /\s$/.test(value);
  const normalized = value.replace(/\s{2,}/g, " ").replace(/^\s+/, "");

  if (!hasTrailingWhitespace) {
    return normalized;
  }

  return normalized.replace(/\s+$/, " ") || " ";
}

function splitSearchInput(value: string): {
  text: string;
  filters: RecognizedFilter[];
} {
  if (!value.trim()) {
    return {
      text: "",
      filters: [],
    };
  }

  const patterns = getFilterPatterns(true);

  const matches: Array<RecognizedFilter & { start: number; end: number }> = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, "gi");
    for (const match of value.matchAll(regex)) {
      const start = match.index;
      const text = match[0];

      if (start === undefined || !text) {
        continue;
      }

      matches.push({
        text,
        tone: pattern.tone,
        start,
        end: start + text.length,
      });
    }
  }

  matches.sort((left, right) => left.start - right.start);

  const filteredMatches: Array<RecognizedFilter & { start: number; end: number }> = [];
  for (const match of matches) {
    const last = filteredMatches.at(-1);
    if (!last || match.start >= last.end) {
      filteredMatches.push(match);
    }
  }

  let cursor = 0;
  const textParts: string[] = [];
  for (const match of filteredMatches) {
    if (cursor < match.start) {
      textParts.push(value.slice(cursor, match.start));
    }
    cursor = match.end;
  }

  if (cursor < value.length) {
    textParts.push(value.slice(cursor));
  }

  return {
    text: normalizeLooseSearchText(textParts.join("")),
    filters: filteredMatches.map((match) => ({
      text: match.text,
      tone: match.tone,
    })),
  };
}

function mergeRecognizedFilters(
  currentFilters: RecognizedFilter[],
  newFilters: RecognizedFilter[],
): RecognizedFilter[] {
  if (!newFilters.length) {
    return currentFilters;
  }

  const result = [...currentFilters];

  for (const filter of newFilters) {
    if (!result.some((item) => item.text === filter.text)) {
      result.push(filter);
    }
  }

  return result;
}

function buildSearchValue(text: string, filters: RecognizedFilter[]) {
  const parts = [...filters.map((filter) => filter.text), text.trim()].filter(Boolean);
  return parts.join(" ").trim();
}

export function IndexPage({ currentUser }: IndexPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [response, setResponse] = useState<ImagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [activeFilters, setActiveFilters] = useState<RecognizedFilter[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const normalized = createDefaultParams(searchParams);
    if (normalized.toString() !== searchParams.toString()) {
      setSearchParams(normalized, { replace: true });
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const data = await getImages(normalized, controller.signal);
        setResponse(data);
        const parsed = splitSearchInput(data.filters.search);
        setSearchInput(parsed.text);
        setActiveFilters(parsed.filters);
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setError("Не удалось загрузить список изображений");
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [searchParams, setSearchParams]);

  const total = response?.total ?? 0;
  const page = response?.page ?? Number(searchParams.get("page") ?? 1);
  const totalPages = response?.total_pages ?? 0;
  const selectedStatus = searchParams.get("status") ?? "";
  const mineOnly = searchParams.get("mine") === "true";
  const recognizedFilters = useMemo(() => buildRecognizedFilters(searchInput), [searchInput]);

  function updateParams(mutator: (next: URLSearchParams) => void) {
    const next = createDefaultParams(searchParams);
    mutator(next);
    next.set("page", "1");
    setSearchParams(next);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = splitSearchInput(`${searchInput} `);
    const nextFilters = mergeRecognizedFilters(activeFilters, parsed.filters);
    setActiveFilters(nextFilters);
    setSearchInput(parsed.text);

    updateParams((next) => {
      const value = buildSearchValue(parsed.text, nextFilters);

      if (!value) {
        next.delete("search");
        return;
      }

      next.set("search", value);
    });
  }

  function removeRecognizedFilter(target: RecognizedFilter) {
    const nextFilters = activeFilters.filter((filter) => filter.text !== target.text);
    setActiveFilters(nextFilters);

    updateParams((next) => {
      const value = buildSearchValue(searchInput, nextFilters);

      if (!value) {
        next.delete("search");
        return;
      }

      next.set("search", value);
    });
  }

  function handleSearchInputChange(value: string) {
    const parsed = splitSearchInput(value);
    setActiveFilters((currentFilters) =>
      mergeRecognizedFilters(currentFilters, parsed.filters),
    );
    setSearchInput(parsed.text);
  }

  return (
    <main className="space-y-6">
      <section className="panel px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Главный каталог</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Каталог изображений
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Всего</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Роль</p>
              <p className="mt-2 text-2xl font-semibold capitalize text-ink">{currentUser.role}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Режим</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{mineOnly ? "Мои" : "Все"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel relative z-30 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5">
          <form className="flex flex-col gap-3 lg:flex-row" onSubmit={handleSearchSubmit}>
            <div className="relative flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(event) => handleSearchInputChange(event.target.value)}
                placeholder="Поиск по имени, тегу, ID или assignee"
                spellCheck={false}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 pr-20 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />

              <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2">
                <button
                  type="button"
                  aria-label="Показать справку по поиску"
                  onClick={() => setHelpOpen((value) => !value)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white transition hover:border-slate-300 hover:scale-105"
                >
                  <img src="/q-icon.png" alt="" className="h-4 w-4 object-contain" />
                </button>
                <div className="pointer-events-none text-slate-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
                  </svg>
                </div>
              </div>

              {helpOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-40 rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Как искать</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                        <p><code className="rounded bg-slate-100 px-2 py-1 text-xs">имя</code> часть названия файла</p>
                        <p><code className="rounded bg-violet-100 px-2 py-1 text-xs text-violet-700">id:5</code> точный id</p>
                        <p><code className="rounded bg-violet-100 px-2 py-1 text-xs text-violet-700">id&gt;10</code> сравнение по id</p>
                        <p><code className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700">count&lt;=3</code> число тегов</p>
                        <p><code className="rounded bg-cyan-100 px-2 py-1 text-xs text-cyan-700">tag:морщина</code> поиск по тегу</p>
                        <p><code className="rounded bg-cyan-100 px-2 py-1 text-xs text-cyan-700">tag:&quot;Кисетные морщины губ&quot;</code> тег с пробелами</p>
                        <p><code className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-700">assignee:username</code> поиск по назначенному</p>
                        <p><code className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-700">assignee:&quot;Иван Петров&quot;</code> значение с пробелами</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHelpOpen(false)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-ink"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Найти
            </button>
          </form>

          {activeFilters.length || recognizedFilters.length ? (
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((filter) => (
                <button
                  key={filter.text}
                  type="button"
                  onClick={() => removeRecognizedFilter(filter)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition hover:opacity-90 ${filter.tone}`}
                >
                  <span>{filter.text}</span>
                  <span className="text-xs leading-none">×</span>
                </button>
              ))}
              {recognizedFilters.map((filter) => (
                <span
                  key={`preview-${filter.text}`}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium opacity-60 ${filter.tone}`}
                >
                  <span>{filter.text}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {imageStatusOptions.map((option) => {
                const isActive = selectedStatus === option.value;

                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      updateParams((next) => {
                        if (!option.value) {
                          next.delete("status");
                          return;
                        }

                        next.set("status", option.value);
                      });
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-accent text-white shadow-soft"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500">
                Найдено: <span className="font-semibold text-ink">{total}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  updateParams((next) => {
                    if (mineOnly) {
                      next.delete("mine");
                      return;
                    }

                    next.set("mine", "true");
                  });
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  mineOnly
                    ? "bg-amber-400 text-slate-950"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                }`}
              >
                Мои назначения
              </button>
              <button
                type="button"
                onClick={() => {
                  setHelpOpen(false);
                  setSearchInput("");
                  setActiveFilters([]);
                  setSearchParams(new URLSearchParams({ page: "1", limit: "12" }));
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-ink"
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-5">
              <div className="h-52 rounded-[22px] bg-slate-100" />
              <div className="mt-5 h-4 w-28 rounded bg-slate-100" />
              <div className="mt-3 h-6 w-3/4 rounded bg-slate-100" />
              <div className="mt-5 flex gap-2">
                <div className="h-7 w-20 rounded-full bg-slate-100" />
                <div className="h-7 w-24 rounded-full bg-slate-100" />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!loading && error ? (
        <section className="panel px-6 py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка данных</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть каталог</h2>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </section>
      ) : null}

      {!loading && !error && response ? (
        <>
          <section className="relative z-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {response.items.length ? (
              response.items.map((image) => <ImageCard key={image.id} image={image} />)
            ) : (
              <div className="panel col-span-full px-6 py-16 text-center">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Пустой результат
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Ничего не найдено</h2>
                <p className="mt-3 text-sm text-slate-600">
                  Попробуй ослабить фильтры или изменить запрос.
                </p>
              </div>
            )}
          </section>

          {totalPages > 1 ? (
            <section className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <div className="text-sm text-slate-500">
                Страница <span className="font-semibold text-ink">{page}</span> из{" "}
                <span className="font-semibold text-ink">{totalPages}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: totalPages }).map((_, index) => {
                  const targetPage = index + 1;
                  const isActive = targetPage === page;

                  return (
                    <button
                      key={targetPage}
                      type="button"
                      onClick={() => {
                        const next = createDefaultParams(searchParams);
                        next.set("page", String(targetPage));
                        setSearchParams(next);
                      }}
                      className={`h-11 min-w-11 rounded-2xl px-4 text-sm font-semibold transition ${
                        isActive
                          ? "bg-slate-950 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink"
                      }`}
                    >
                      {targetPage}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
