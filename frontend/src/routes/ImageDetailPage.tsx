import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  assignImage,
  deleteImage,
  getImageDetail,
  getSegmentations,
  updateImage,
  verifyImage,
} from "../lib/api";
import type { CurrentUser, ImageDetailResponse, SegmentationMap } from "../lib/api";
import {
  IMAGE_STATUS_DONE,
  IMAGE_STATUS_MARKUP_REVIEW,
  IMAGE_STATUS_READY_FOR_MARKUP,
  IMAGE_STATUS_TAGS_PENDING,
  canOpenImageEditor,
  imageStatusLabel,
  imageStatusTone,
} from "../lib/imageStatus";

type ImageDetailPageProps = {
  currentUser: CurrentUser;
};

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ImageDetailPage({ currentUser }: ImageDetailPageProps) {
  const params = useParams();
  const imageId = Number(params.imageId);
  const [detail, setDetail] = useState<ImageDetailResponse | null>(null);
  const [segmentations, setSegmentations] = useState<SegmentationMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!Number.isFinite(imageId)) {
      setError("Неверный идентификатор изображения");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const [detailResponse, segmentationResponse] = await Promise.all([
          getImageDetail(imageId, controller.signal),
          getSegmentations(imageId, controller.signal),
        ]);
        setDetail(detailResponse);
        setSegmentations(segmentationResponse);
        setName(detailResponse.image.name);
        setSelectedTags(detailResponse.image.tags);
      } catch (err) {
        if (err instanceof Response && err.status === 401) {
          window.location.assign("/login");
          return;
        }

        setError("Не удалось загрузить изображение");
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [imageId]);

  const image = detail?.image ?? null;
  const authorsLabel = image?.authors.length
    ? image.authors.map((author) => author.username).join(", ")
    : image?.author?.username ?? "admin";

  const canEdit = currentUser.permissions.at_least_worker;
  const canAdmin = currentUser.permissions.is_admin;

  const displayTags = useMemo(() => selectedTags.length ? selectedTags : image?.tags ?? [], [image?.tags, selectedTags]);

  useEffect(() => {
    const imgEl = imageRef.current;
    const canvas = canvasRef.current;
    if (!imgEl || !canvas || !image) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const currentImage = imgEl;
    const currentCanvas = canvas;
    const currentContext = context;

    function normalizePoint(point: { x: number; y: number }) {
      const x = point.x <= 1 ? point.x : point.x / (currentImage.naturalWidth || currentCanvas.width);
      const y = point.y <= 1 ? point.y : point.y / (currentImage.naturalHeight || currentCanvas.height);
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    }

    function drawMarks() {
      const rect = currentImage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (currentCanvas.width !== width || currentCanvas.height !== height) {
        currentCanvas.width = width;
        currentCanvas.height = height;
      }

      currentContext.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
      currentContext.lineJoin = "round";
      currentContext.lineCap = "round";
      currentContext.lineWidth = Math.max(2, Math.round(Math.min(currentCanvas.width, currentCanvas.height) * 0.012));
      currentContext.strokeStyle = "rgba(16,185,129,0.65)";

      Object.values(segmentations).forEach((lines) => {
        lines.forEach((line) => {
          if (!line.length) {
            return;
          }

          currentContext.beginPath();
          line.forEach((point, index) => {
            const normalized = normalizePoint(point);
            const px = normalized.x * currentCanvas.width;
            const py = normalized.y * currentCanvas.height;
            if (index === 0) {
              currentContext.moveTo(px, py);
              return;
            }
            currentContext.lineTo(px, py);
          });
          currentContext.stroke();
        });
      });
    }

    const onLoad = () => drawMarks();
    currentImage.addEventListener("load", onLoad);
    if (currentImage.complete) {
      drawMarks();
    }

    const resizeObserver = new ResizeObserver(() => drawMarks());
    resizeObserver.observe(currentImage);
    window.addEventListener("resize", drawMarks);

    return () => {
      currentImage.removeEventListener("load", onLoad);
      resizeObserver.disconnect();
      window.removeEventListener("resize", drawMarks);
    };
  }, [image, segmentations]);

  function toggleTag(tag: string) {
    setSelectedTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag],
    );
  }

  async function handleSave() {
    if (!image) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await updateImage(image.id, {
        name: name.trim(),
        tags: selectedTags,
      });

      if (detail) {
        setDetail({
          ...detail,
          image: response.image,
        });
      }
    } catch (err) {
      setError("Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(assignedUserId: string) {
    if (!image) {
      return;
    }

    setAssigning(true);
    setError("");

    try {
      const response = await assignImage(
        image.id,
        assignedUserId ? Number(assignedUserId) : null,
      );

      if (detail) {
        setDetail({
          ...detail,
          image: response.image,
        });
      }
    } catch (err) {
      setError("Не удалось назначить пользователя");
    } finally {
      setAssigning(false);
    }
  }

  async function handleVerify(status: number) {
    if (!image) {
      return;
    }

    try {
      const response = await verifyImage(image.id, status);
      if (detail) {
        setDetail({
          ...detail,
          image: response.image,
        });
      }
    } catch (err) {
      setError("Не удалось изменить статус");
    }
  }

  async function handleDelete() {
    if (!image) {
      return;
    }

    const confirmed = window.confirm("Удалить изображение?");
    if (!confirmed) {
      return;
    }

    try {
      const response = await deleteImage(image.id);
      window.location.assign(response.redirect_url);
    } catch (err) {
      setError("Не удалось удалить изображение");
    }
  }

  if (loading) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Загрузка</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Подготавливаем карточку изображения</h1>
      </section>
    );
  }

  if (error && !image) {
    return (
      <section className="panel px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Ошибка</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Не удалось открыть изображение</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </section>
    );
  }

  if (!detail || !image) {
    return null;
  }

  return (
    <main className="space-y-6">
      <section className="panel px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Карточка изображения</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{image.name}</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${imageStatusTone(image.is_verified)}`}>
              {imageStatusLabel(image.is_verified)}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
              ID: <span className="font-semibold text-ink">{image.id}</span>
            </span>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="panel px-6 py-6">
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50">
            <img ref={imageRef} src={image.file_path} alt={image.name} className="w-full object-contain" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Авторы</dt>
              <dd className="mt-2 text-sm font-semibold text-ink">{authorsLabel}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Назначено</dt>
              <dd className="mt-2 text-sm font-semibold text-ink">{image.assigned_user?.username ?? "—"}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Дата загрузки</dt>
              <dd className="mt-2 text-sm font-semibold text-ink">{formatDate(image.uploaded_at)}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-2">
            {displayTags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-950 px-3 py-1.5 text-sm font-medium text-white">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {canAdmin ? (
            <section className="panel px-6 py-6">
              <h2 className="text-lg font-semibold text-ink">Назначение</h2>
              <select
                value={image.assigned_user?.id ?? ""}
                onChange={(event) => void handleAssign(event.target.value)}
                disabled={assigning}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
              >
                <option value="">— Никто —</option>
                {detail.assignee_options.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </section>
          ) : null}

          <section className="panel px-6 py-6">
            <h2 className="text-lg font-semibold text-ink">Действия</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {canAdmin && image.is_verified === IMAGE_STATUS_TAGS_PENDING ? (
                <button
                  type="button"
                  onClick={() => void handleVerify(IMAGE_STATUS_READY_FOR_MARKUP)}
                  className="rounded-2xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                >
                  Готово к разметке
                </button>
              ) : null}
              {canAdmin && image.is_verified === IMAGE_STATUS_MARKUP_REVIEW ? (
                <button
                  type="button"
                  onClick={() => void handleVerify(IMAGE_STATUS_DONE)}
                  className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Подтвердить разметку
                </button>
              ) : null}
              {canAdmin && image.is_verified === IMAGE_STATUS_MARKUP_REVIEW ? (
                <button
                  type="button"
                  onClick={() => void handleVerify(IMAGE_STATUS_READY_FOR_MARKUP)}
                  className="rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
                >
                  Вернуть к разметке
                </button>
              ) : null}
              {canAdmin ? (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
                >
                  Удалить
                </button>
              ) : null}
              {canOpenImageEditor(image.is_verified) && canEdit ? (
                <a
                  href={`/image/${image.id}/editor`}
                  className="rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-700"
                >
                  Разметить
                </a>
              ) : null}
            </div>
            {!canOpenImageEditor(image.is_verified) && canEdit ? (
              <p className="mt-4 text-sm text-slate-500">
                Разметка откроется после первичной проверки тегов администратором.
              </p>
            ) : null}
          </section>

          {canEdit ? (
            <section className="panel px-6 py-6">
              <h2 className="text-lg font-semibold text-ink">Редактирование</h2>

              <div className="mt-5 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Название</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition focus:border-sky-200 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Теги</label>
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    {detail.all_tags.map((tag) => {
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
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave()}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Сохраняем..." : "Сохранить изменения"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <section className="panel flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        {detail.prev_id ? (
          <a
            href={`/image/${detail.prev_id}`}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
          >
            ← Назад
          </a>
        ) : (
          <div />
        )}

        {detail.next_id ? (
          <a
            href={`/image/${detail.next_id}`}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
          >
            Вперёд →
          </a>
        ) : null}
      </section>
    </main>
  );
}
