import { useEffect, useMemo, useState } from "react";

import {
  getStatsOverview,
  getStatsTagCombos,
  getStatsTagPercent,
  getStatsTags,
} from "../lib/api";

function formatPercent(value: number) {
  return `${value.toFixed(0)}%`;
}

function formatDecimal(value: number) {
  return value.toFixed(1);
}

function statusTone(index: number) {
  const tones = [
    "bg-rose-500",
    "bg-amber-400",
    "bg-emerald-500",
    "bg-slate-400",
  ];

  return tones[index % tones.length];
}

function donutSegments(items: Array<{ label: string; value: number; color: string }>) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }

  let start = 0;
  const stops = items.map((item) => {
    const angle = (item.value / total) * 360;
    const stop = `${item.color} ${start}deg ${start + angle}deg`;
    start += angle;
    return stop;
  });

  return `conic-gradient(${stops.join(", ")})`;
}

export function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getStatsOverview>> | null>(null);
  const [tags, setTags] = useState<Awaited<ReturnType<typeof getStatsTags>> | null>(null);
  const [tagPercent, setTagPercent] = useState<Awaited<ReturnType<typeof getStatsTagPercent>> | null>(null);
  const [combos, setCombos] = useState<Awaited<ReturnType<typeof getStatsTagCombos>> | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const [overviewData, tagsData, percentData, combosData] = await Promise.all([
          getStatsOverview(controller.signal),
          getStatsTags(controller.signal),
          getStatsTagPercent(controller.signal),
          getStatsTagCombos(controller.signal),
        ]);

        setOverview(overviewData);
        setTags(tagsData);
        setTagPercent(percentData);
        setCombos(combosData);
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setError("Не удалось загрузить статистику");
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const topTags = useMemo(() => {
    if (!tags) {
      return [];
    }

    return tags.tags
      .map((tag, index) => ({
        label: tag,
        value: tags.counts[index] ?? 0,
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 8);
  }, [tags]);

  const tagPercentItems = useMemo(() => {
    if (!tagPercent) {
      return [];
    }

    return tagPercent.tags
      .map((tag, index) => ({
        label: tag,
        value: tagPercent.percentages[index] ?? 0,
        color: `hsl(${(index * 43) % 360} 78% 56%)`,
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6);
  }, [tagPercent]);

  const statusCards = overview
    ? [
        { label: "Теги не проверены", value: overview.verified_counts.unverified, color: "bg-rose-500", accent: "text-rose-600" },
        { label: "Готово к разметке", value: overview.verified_counts.ready_for_markup, color: "bg-amber-400", accent: "text-amber-600" },
        { label: "Разметка на проверке", value: overview.verified_counts.markup_review, color: "bg-violet-500", accent: "text-violet-600" },
        { label: "Готово", value: overview.verified_counts.done, color: "bg-emerald-500", accent: "text-emerald-600" },
        { label: "Без статуса", value: overview.verified_counts.unknown, color: "bg-slate-400", accent: "text-slate-600" },
      ]
    : [];

  if (loading) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Info</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Подготавливаем аналитическую панель</h1>
      </section>
    );
  }

  if (error || !overview || !tags || !tagPercent || !combos) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка данных</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть аналитику</h1>
        <p className="mt-2 text-sm text-slate-600">{error || "Недостаточно данных для отображения"}</p>
      </section>
    );
  }

  return (
    <main className="space-y-6">
      <section className="panel overflow-hidden px-6 py-6 sm:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_rgba(8,145,178,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(244,114,182,0.16),_transparent_30%)]" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Info</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Панель метрик разметки
            </h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Покрытие проверки</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{formatPercent(overview.verification_completion)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Топ тег</p>
              <p className="mt-2 text-lg font-semibold text-ink">
                {overview.top_tag.name ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {overview.top_tag.count} вхождений
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="panel px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Изображения</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{overview.total_images}</p>
          <p className="mt-2 text-sm text-slate-500">Всего объектов в каталоге</p>
        </div>
        <div className="panel px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Уникальные теги</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{overview.unique_tags}</p>
          <p className="mt-2 text-sm text-slate-500">Текущая ширина таксономии</p>
        </div>
        <div className="panel px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Среднее тегов</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{formatDecimal(overview.average_tags_per_image)}</p>
          <p className="mt-2 text-sm text-slate-500">Насыщенность аннотаций на изображение</p>
        </div>
        <div className="panel px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Без назначения</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{overview.unassigned_images}</p>
          <p className="mt-2 text-sm text-slate-500">Изображений без ответственного</p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="panel px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Pipeline</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Статусы изображений</h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              {overview.total_images} всего
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {statusCards.map((item) => {
              const ratio = overview.total_images ? (item.value / overview.total_images) * 100 : 0;

              return (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full ${item.color}`} />
                      <span className="text-sm font-medium text-slate-600">{item.label}</span>
                    </div>
                    <div className={`text-sm font-semibold ${item.accent}`}>
                      {item.value}
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100">
                    <div
                      className={`h-3 rounded-full ${item.color}`}
                      style={{ width: `${Math.max(ratio, item.value ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Composition</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Структура тегов</h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              {overview.total_tag_links} аннотаций
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:items-center">
            <div className="mx-auto">
              <div
                className="relative h-52 w-52 rounded-full"
                style={{ background: donutSegments(tagPercentItems) }}
              >
                <div className="absolute inset-[22px] rounded-full bg-white" />
                <div className="absolute inset-0 flex items-center justify-center text-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Теги</p>
                    <p className="mt-2 text-3xl font-semibold text-ink">{overview.unique_tags}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {tagPercentItems.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm font-medium text-slate-700">{item.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-ink">{item.value.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="panel px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Top Tags</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Самые частые теги</h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              топ {topTags.length}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {topTags.map((item, index) => {
              const max = topTags[0]?.value ?? 1;
              const ratio = max ? (item.value / max) * 100 : 0;

              return (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${statusTone(index)}`}>
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-700">{item.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-ink">{item.value}</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100">
                    <div
                      className={`h-3 rounded-full ${statusTone(index)}`}
                      style={{ width: `${Math.max(ratio, 8)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Co-occurrence</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Топ сочетаний</h2>
            </div>
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              пары тегов
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {combos.combos.length ? (
              combos.combos.map((combo, index) => (
                <div key={combo} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                        сочетание {index + 1}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-ink">{combo}</p>
                    </div>
                    <div className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white">
                      {combos.counts[index] ?? 0}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Пока недостаточно данных для устойчивых сочетаний тегов.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
