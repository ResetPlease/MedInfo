import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createAdminTag,
  createAdminUser,
  deleteAdminTag,
  getAdminSummary,
  getAdminTags,
  getAdminUserDetail,
  getAdminUsers,
} from "../lib/api";
import type {
  AdminSummaryResponse,
  AdminTagsResponse,
  AdminUserDetailResponse,
  AdminUserListItem,
  CurrentUser,
} from "../lib/api";
import { imageStatusLabel, imageStatusTone } from "../lib/imageStatus";

type AdminPageProps = {
  currentUser: CurrentUser;
};

type AdminTab = "overview" | "users" | "tags";

const adminTabs: Array<{ id: AdminTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "users", label: "Пользователи" },
  { id: "tags", label: "Теги" },
];

function normalizeTab(value: string | null): AdminTab {
  if (value === "users" || value === "tags") {
    return value;
  }

  return "overview";
}

function roleTone(role: string) {
  if (role === "owner") {
    return "bg-rose-100 text-rose-700 ring-1 ring-rose-200";
  }

  if (role === "worker") {
    return "bg-sky-100 text-sky-700 ring-1 ring-sky-200";
  }

  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function aggregateActivity(
  dates: string[],
  counts: number[],
): Array<{ label: string; value: number }> {
  if (!dates.length) {
    return [];
  }

  if (dates.length <= 12) {
    return dates.map((label, index) => ({
      label,
      value: counts[index] ?? 0,
    }));
  }

  const buckets = new Map<string, number>();

  dates.forEach((rawDate, index) => {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + (counts[index] ?? 0));
  });

  return Array.from(buckets.entries()).map(([label, value]) => ({
    label,
    value,
  }));
}

function buildRecentDayKeys(days: number): string[] {
  const anchor = new Date();
  anchor.setHours(0, 0, 0, 0);

  const keys: string[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const current = new Date(anchor);
    current.setDate(anchor.getDate() - index);
    keys.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`,
    );
  }

  return keys;
}

function formatDayKey(key: string) {
  const [year, month, day] = key.split("-");
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return parsed.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function buildMiniActivity(
  dates: string[],
  counts: number[],
  dayKeys: string[],
): Array<{ label: string; value: number }> {
  const buckets = new Map<string, number>();
  dayKeys.forEach((key) => buckets.set(key, 0));

  dates.forEach((rawDate, index) => {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const key =
      `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    if (!buckets.has(key)) {
      return;
    }

    buckets.set(key, (buckets.get(key) ?? 0) + (counts[index] ?? 0));
  });

  return dayKeys.map((key) => ({
    label: formatDayKey(key),
    value: buckets.get(key) ?? 0,
  }));
}

function ActivityBars({
  items,
  barTone,
  emptyLabel,
}: {
  items: Array<{ label: string; value: number }>;
  barTone: string;
  emptyLabel: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-500">{item.label}</span>
            <span className="text-xs font-semibold text-ink">{item.value}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div
              className={`h-2.5 rounded-full ${barTone}`}
              style={{ width: `${Math.max((item.value / maxValue) * 100, item.value ? 8 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniActivityBars({
  items,
  maxValue,
}: {
  items: Array<{ label: string; value: number }>;
  maxValue: number;
}) {
  const normalizedMax = Math.max(maxValue, 1);

  return (
    <div className="flex min-w-[200px] items-end gap-1">
      {items.map((item) => {
        const ratio = item.value ? Math.sqrt(item.value) / Math.sqrt(normalizedMax) : 0;
        const height = item.value ? Math.max(ratio * 52, 8) : 6;
        return (
          <div
            key={item.label}
            className="flex-1 rounded-t-full bg-sky-100"
            style={{ height: `${height}px` }}
            title={`${item.label}: ${item.value}`}
          >
            <div className="h-full rounded-t-full bg-sky-500" />
          </div>
        );
      })}
    </div>
  );
}

export function AdminPage({ currentUser }: AdminPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [tags, setTags] = useState<AdminTagsResponse["items"]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetailResponse | null>(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [selectedUserError, setSelectedUserError] = useState("");
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    role: "worker",
  });
  const [tagName, setTagName] = useState("");
  const [userSubmitError, setUserSubmitError] = useState("");
  const [tagSubmitError, setTagSubmitError] = useState("");
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [tagSubmitting, setTagSubmitting] = useState(false);
  const [tagDeletingId, setTagDeletingId] = useState<number | null>(null);

  const activeTab = normalizeTab(searchParams.get("tab"));
  const selectedUserId = Number(searchParams.get("user") ?? 0) || null;

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const [summaryData, usersData, tagsData] = await Promise.all([
          getAdminSummary(controller.signal),
          getAdminUsers(controller.signal),
          getAdminTags(controller.signal),
        ]);

        setSummary(summaryData);
        setUsers(usersData);
        setTags(tagsData.items);

        const hasSelectedUser = usersData.some((user) => user.id === selectedUserId);
        if (!selectedUserId && usersData.length) {
          const next = new URLSearchParams(searchParams);
          next.set("user", String(usersData[0].id));
          setSearchParams(next, { replace: true });
        } else if (selectedUserId && !hasSelectedUser && usersData.length) {
          const next = new URLSearchParams(searchParams);
          next.set("user", String(usersData[0].id));
          setSearchParams(next, { replace: true });
        }
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setError("Не удалось загрузить admin-панель");
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [searchParams, selectedUserId, setSearchParams]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null);
      setSelectedUserError("");
      return;
    }

    const controller = new AbortController();
    setSelectedUserLoading(true);
    setSelectedUserError("");

    void (async () => {
      try {
        const data = await getAdminUserDetail(selectedUserId, controller.signal);
        setSelectedUser(data);
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setSelectedUser(null);
        setSelectedUserError("Не удалось загрузить карточку пользователя");
      } finally {
        setSelectedUserLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedUserId]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((left, right) => {
      if (right.images !== left.images) {
        return right.images - left.images;
      }

      return left.username.localeCompare(right.username, "ru");
    });
  }, [users]);

  const topContributors = sortedUsers.slice(0, 5);
  const tagLeaders = [...tags].sort((left, right) => right.images_count - left.images_count).slice(0, 6);
  const userActivity = selectedUser
    ? aggregateActivity(selectedUser.activity_dates, selectedUser.activity_counts)
    : [];
  const recentDayKeys = useMemo(() => buildRecentDayKeys(7), []);
  const miniActivityByUser = useMemo(() => {
    return new Map(
      users.map((user) => [
        user.id,
        buildMiniActivity(user.activity_dates, user.activity_counts, recentDayKeys),
      ]),
    );
  }, [recentDayKeys, users]);
  const miniActivityMax = useMemo(() => {
    const values = Array.from(miniActivityByUser.values()).flatMap((items) => items.map((item) => item.value));
    return Math.max(...values, 1);
  }, [miniActivityByUser]);

  async function reloadSummaryAndUsers() {
    const [summaryData, usersData] = await Promise.all([
      getAdminSummary(),
      getAdminUsers(),
    ]);

    setSummary(summaryData);
    setUsers(usersData);
  }

  async function reloadTags() {
    const tagsData = await getAdminTags();
    setTags(tagsData.items);
  }

  function updateTab(tab: AdminTab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  function selectUser(userId: number) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "users");
    next.set("user", String(userId));
    setSearchParams(next, { replace: true });
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setUserSubmitting(true);
    setUserSubmitError("");

    try {
      await createAdminUser(userForm);
      setUserForm({
        username: "",
        password: "",
        role: "worker",
      });
      await reloadSummaryAndUsers();
    } catch (err) {
      if (err instanceof Response) {
        const payload = await err.json().catch(() => null);
        setUserSubmitError(payload?.detail ?? "Не удалось создать пользователя");
      } else {
        setUserSubmitError("Не удалось создать пользователя");
      }
    } finally {
      setUserSubmitting(false);
    }
  }

  async function handleCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setTagSubmitting(true);
    setTagSubmitError("");

    try {
      await createAdminTag(tagName);
      setTagName("");
      await Promise.all([reloadTags(), reloadSummaryAndUsers()]);
    } catch (err) {
      if (err instanceof Response) {
        const payload = await err.json().catch(() => null);
        setTagSubmitError(payload?.detail ?? "Не удалось создать тег");
      } else {
        setTagSubmitError("Не удалось создать тег");
      }
    } finally {
      setTagSubmitting(false);
    }
  }

  async function handleDeleteTag(tagId: number) {
    setTagDeletingId(tagId);
    setTagSubmitError("");

    try {
      await deleteAdminTag(tagId);
      await Promise.all([reloadTags(), reloadSummaryAndUsers()]);
    } catch (err) {
      if (err instanceof Response) {
        const payload = await err.json().catch(() => null);
        setTagSubmitError(payload?.detail ?? "Не удалось удалить тег");
      } else {
        setTagSubmitError("Не удалось удалить тег");
      }
    } finally {
      setTagDeletingId(null);
    }
  }

  if (!currentUser.permissions.is_admin) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Доступ ограничен</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Admin-панель недоступна</h1>
        <p className="mt-3 text-sm text-slate-600">Для этого раздела нужна роль owner.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Admin</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Собираем административную панель</h1>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка данных</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть admin-панель</h1>
        <p className="mt-3 text-sm text-slate-600">{error || "Недостаточно данных для отображения"}</p>
      </section>
    );
  }

  return (
    <main className="space-y-6">
      <section className="panel overflow-hidden px-6 py-6 sm:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_28%)]" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Управление системой
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Пользователи, теги и общая операционная статистика в одной панели.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Пользователи</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{summary.total_users}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Изображения</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{summary.total_images}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Сегментации</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{summary.total_segmentations}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Теги</p>
              <p className="mt-2 text-3xl font-semibold text-ink">{summary.total_tags}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {adminTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => updateTab(tab.id)}
            className={
              activeTab === tab.id
                ? "rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white"
                : "rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
            }
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "overview" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="panel px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Owner</p>
              <p className="mt-3 text-3xl font-semibold text-ink">{summary.roles.owner}</p>
            </div>
            <div className="panel px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Worker</p>
              <p className="mt-3 text-3xl font-semibold text-ink">{summary.roles.worker}</p>
            </div>
            <div className="panel px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Guest</p>
              <p className="mt-3 text-3xl font-semibold text-ink">{summary.roles.guest}</p>
            </div>
            <div className="panel px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Без назначения</p>
              <p className="mt-3 text-3xl font-semibold text-ink">{summary.unassigned_images}</p>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="panel px-6 py-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Verification</p>
                  <h2 className="mt-2 text-xl font-semibold text-ink">Статусы изображений</h2>
                </div>
                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                  {summary.total_images} всего
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  { label: "Теги не проверены", value: summary.verification.unverified, tone: "bg-rose-500" },
                  { label: "Готово к разметке", value: summary.verification.ready_for_markup, tone: "bg-amber-400" },
                  { label: "Разметка на проверке", value: summary.verification.markup_review, tone: "bg-violet-500" },
                  { label: "Готово", value: summary.verification.done, tone: "bg-emerald-500" },
                ].map((item) => {
                  const ratio = summary.total_images ? (item.value / summary.total_images) * 100 : 0;

                  return (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-600">{item.label}</span>
                        <span className="text-sm font-semibold text-ink">{item.value}</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-100">
                        <div
                          className={`h-3 rounded-full ${item.tone}`}
                          style={{ width: `${Math.max(ratio, item.value ? 6 : 0)}%` }}
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
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Contributors</p>
                  <h2 className="mt-2 text-xl font-semibold text-ink">Самые активные пользователи</h2>
                </div>
                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                  топ {topContributors.length}
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {topContributors.map((user, index) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => selectUser(user.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{user.username}</p>
                        <p className="mt-1 text-xs text-slate-500">{user.images} изображений • {user.segmentations} сегментаций</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${roleTone(user.role)}`}>
                      {user.role}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className="panel px-6 py-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Taxonomy</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Теги с самым широким покрытием</h2>
              <div className="mt-6 space-y-3">
                {tagLeaders.map((tag) => {
                  const ratio = summary.total_images ? (tag.images_count / summary.total_images) * 100 : 0;

                  return (
                    <div key={tag.id}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-700">{tag.name}</span>
                        <span className="text-sm font-semibold text-ink">{tag.images_count}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100">
                        <div
                          className="h-2.5 rounded-full bg-sky-500"
                          style={{ width: `${Math.max(ratio, tag.images_count ? 6 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel px-6 py-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Quick Actions</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Быстрые точки контроля</h2>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => updateTab("users")}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                >
                  <p className="text-sm font-semibold text-ink">Пользователи</p>
                  <p className="mt-1 text-sm text-slate-500">Создать учётку и проверить активность команды.</p>
                </button>
                <button
                  type="button"
                  onClick={() => updateTab("tags")}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                >
                  <p className="text-sm font-semibold text-ink">Теги</p>
                  <p className="mt-1 text-sm text-slate-500">Поддерживать словарь тегов и его покрытие.</p>
                </button>
              </div>
            </section>
          </section>
        </>
      ) : null}

      {activeTab === "users" ? (
        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-5">
            <section className="panel px-6 py-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Users</p>
                  <h2 className="mt-2 text-xl font-semibold text-ink">Команда</h2>
                </div>
                <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                  {users.length} пользователей
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {sortedUsers.map((user) => {
                  const isActive = user.id === selectedUserId;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => selectUser(user.id)}
                      className={
                        isActive
                          ? "w-full rounded-[26px] border border-sky-200 bg-sky-50 px-5 py-4 text-left shadow-soft"
                          : "w-full rounded-[26px] border border-slate-200 bg-white px-5 py-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                      }
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <p className="text-base font-semibold text-ink">{user.username}</p>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${roleTone(user.role)}`}>
                              {user.role}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-500">
                            {user.images} изображений • {user.segmentations} сегментаций • {user.assigned_images} назначено
                          </p>
                        </div>
                        <MiniActivityBars
                          items={miniActivityByUser.get(user.id) ?? buildMiniActivity([], [], recentDayKeys)}
                          maxValue={miniActivityMax}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </section>

          <aside className="space-y-5">
            <section className="panel px-6 py-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Create User</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Новый пользователь</h2>

              <form className="mt-6 space-y-4" onSubmit={(event) => void handleCreateUser(event)}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Логин</label>
                  <input
                    value={userForm.username}
                    onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Пароль</label>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Роль</label>
                  <select
                    value={userForm.role}
                    onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  >
                    <option value="owner">owner</option>
                    <option value="worker">worker</option>
                    <option value="guest">guest</option>
                  </select>
                </div>

                {userSubmitError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {userSubmitError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={userSubmitting}
                  className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {userSubmitting ? "Создаём..." : "Создать пользователя"}
                </button>
              </form>
            </section>

            <section className="panel px-6 py-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">User Detail</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Карточка пользователя</h2>

              {selectedUserLoading ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Загружаем пользователя...
                </div>
              ) : null}

              {!selectedUserLoading && selectedUserError ? (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                  {selectedUserError}
                </div>
              ) : null}

              {!selectedUserLoading && !selectedUserError && selectedUser ? (
                <div className="mt-6 space-y-5">
                  <div className="rounded-[26px] border border-slate-200 bg-slate-50 px-5 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-ink">{selectedUser.username}</p>
                        <p className="mt-1 text-sm text-slate-500">{selectedUser.images.length} изображений</p>
                      </div>
                      <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${roleTone(selectedUser.role)}`}>
                        {selectedUser.role}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-sm font-semibold text-slate-500">Активность</p>
                    <ActivityBars
                      items={userActivity}
                      barTone="bg-sky-500"
                      emptyLabel="Нет данных по загрузкам"
                    />
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-500">Последние изображения</p>
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {selectedUser.images.length} всего
                      </span>
                    </div>
                    <div className="space-y-3">
                      {selectedUser.images.slice(0, 8).map((image) => (
                        <a
                          key={image.id}
                          href={`/image/${image.id}`}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">{image.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(image.uploaded_at)} • {image.segmentations} сегментаций
                            </p>
                          </div>
                          <span className={`ml-4 rounded-full px-3 py-1 text-xs font-semibold ${imageStatusTone(image.is_verified)}`}>
                            {imageStatusLabel(image.is_verified)}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </aside>
        </section>
      ) : null}

      {activeTab === "tags" ? (
        <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="panel px-6 py-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Create Tag</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Новый тег</h2>

            <form className="mt-6 space-y-4" onSubmit={(event) => void handleCreateTag(event)}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-600">Название</label>
                <input
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                />
              </div>

              {tagSubmitError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {tagSubmitError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={tagSubmitting}
                className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tagSubmitting ? "Добавляем..." : "Добавить тег"}
              </button>
            </form>
          </section>

          <section className="panel px-6 py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Tags</p>
                <h2 className="mt-2 text-xl font-semibold text-ink">Словарь тегов</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                {tags.length} тегов
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">{tag.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{tag.images_count} изображений</p>
                  </div>

                  <button
                    type="button"
                    disabled={tagDeletingId === tag.id}
                    onClick={() => void handleDeleteTag(tag.id)}
                    className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {tagDeletingId === tag.id ? "Удаляем..." : "Удалить"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}
