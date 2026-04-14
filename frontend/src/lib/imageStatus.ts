export const IMAGE_STATUS_TAGS_PENDING = 0;
export const IMAGE_STATUS_READY_FOR_MARKUP = 1;
export const IMAGE_STATUS_MARKUP_REVIEW = 2;
export const IMAGE_STATUS_DONE = 3;

export function imageStatusLabel(status: number | null) {
  if (status === IMAGE_STATUS_TAGS_PENDING) {
    return "Теги не проверены";
  }

  if (status === IMAGE_STATUS_READY_FOR_MARKUP) {
    return "Готово к разметке";
  }

  if (status === IMAGE_STATUS_MARKUP_REVIEW) {
    return "Разметка на проверке";
  }

  if (status === IMAGE_STATUS_DONE) {
    return "Готово";
  }

  if (status === null) {
    return "Без статуса";
  }

  return `Неизвестный статус (${status})`;
}

export function imageStatusTone(status: number | null) {
  if (status === IMAGE_STATUS_TAGS_PENDING) {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }

  if (status === IMAGE_STATUS_READY_FOR_MARKUP) {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }

  if (status === IMAGE_STATUS_MARKUP_REVIEW) {
    return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  }

  if (status === IMAGE_STATUS_DONE) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }

  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
}

export function canOpenImageEditor(status: number | null) {
  return status !== null && status >= IMAGE_STATUS_READY_FOR_MARKUP;
}

export const imageStatusOptions = [
  { label: "Все", value: "" },
  { label: "Теги не проверены", value: String(IMAGE_STATUS_TAGS_PENDING) },
  { label: "Готово к разметке", value: String(IMAGE_STATUS_READY_FOR_MARKUP) },
  { label: "Разметка на проверке", value: String(IMAGE_STATUS_MARKUP_REVIEW) },
  { label: "Готово", value: String(IMAGE_STATUS_DONE) },
];
