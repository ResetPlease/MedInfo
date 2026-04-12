import type { ImageCard as ImageCardModel } from "../lib/api";
import { imageStatusLabel, imageStatusTone } from "../lib/imageStatus";

type ImageCardProps = {
  image: ImageCardModel;
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

export function ImageCard({ image }: ImageCardProps) {
  return (
    <a
      href={`/image/${image.id}`}
      className="group overflow-hidden rounded-[28px] border border-slate-200 bg-white transition duration-200 hover:-translate-y-1 hover:border-sky-200 hover:shadow-panel"
    >
      <div className="relative">
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
          {image.assigned_user ? (
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                image.assigned_to_current_user
                  ? "bg-amber-400 text-slate-950"
                  : "bg-slate-950/80 text-white"
              }`}
            >
              {image.assigned_to_current_user ? "Назначено мне" : `Назначено: ${image.assigned_user.username}`}
            </span>
          ) : (
            <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-500">
              Свободно
            </span>
          )}
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${imageStatusTone(image.is_verified)}`}>
            {imageStatusLabel(image.is_verified)}
          </span>
        </div>

        <img
          src={image.file_path}
          alt={image.name}
          className="h-52 w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Image #{image.id}</p>
            <h3 className="mt-2 truncate text-lg font-semibold text-ink" title={image.name}>
              {image.name}
            </h3>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {image.tags.length ? (
            image.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              Без тегов
            </span>
          )}
          {image.tags.length > 4 ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              +{image.tags.length - 4}
            </span>
          ) : null}
        </div>

        <dl className="mt-5 grid gap-2 text-sm text-slate-500">
          <div className="flex items-center justify-between gap-4">
            <dt>Автор</dt>
            <dd className="truncate font-medium text-slate-700">{image.author?.username ?? "admin"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Назначено</dt>
            <dd className="truncate font-medium text-slate-700">{image.assigned_user?.username ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Дата</dt>
            <dd className="font-medium text-slate-700">{formatDate(image.uploaded_at)}</dd>
          </div>
        </dl>
      </div>
    </a>
  );
}
