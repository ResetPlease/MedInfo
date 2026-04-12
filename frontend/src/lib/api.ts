export type CurrentUser = {
  id: number;
  username: string;
  role: string;
  permissions: {
    is_admin: boolean;
    at_least_worker: boolean;
  };
};

export type RelatedUser = {
  id: number;
  username: string;
  role: string;
};

export type ImageCard = {
  id: number;
  name: string;
  file_path: string;
  tags: string[];
  tags_display: string;
  is_verified: number | null;
  uploaded_at: string | null;
  author: RelatedUser | null;
  authors: RelatedUser[];
  assigned_user: RelatedUser | null;
  assigned_to_current_user: boolean;
};

export type ImageDetailResponse = {
  image: ImageCard;
  all_tags: string[];
  prev_id: number | null;
  next_id: number | null;
  assignee_options: RelatedUser[];
  current_user: CurrentUser;
};

export type ImagesResponse = {
  items: ImageCard[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  filters: {
    search: string;
    status: number | null;
    mine: boolean;
    unverified: boolean;
  };
  current_user: CurrentUser;
};

export type TagsResponse = {
  items: string[];
};

export type UploadImageResponse = {
  image: ImageCard;
  redirect_url: string;
};

export type PredictTagsResponse = {
  wrinkles: string[];
};

export type SegmentationMap = Record<string, Array<Array<{ x: number; y: number }>>>;

export type ImageEditorResponse = {
  image: ImageCard;
  editor_tags: string[];
  segmentations: SegmentationMap;
  prev_id: number | null;
  next_id: number | null;
  current_user: CurrentUser;
};

export type StatsOverviewResponse = {
  total_images: number;
  unique_tags: number;
  total_tag_links: number;
  average_tags_per_image: number;
  unassigned_images: number;
  verified_counts: {
    unverified: number;
    ready_for_markup: number;
    markup_review: number;
    done: number;
    unknown: number;
  };
  verification_completion: number;
  top_tag: {
    name: string | null;
    count: number;
  };
};

export type StatsTagsResponse = {
  tags: string[];
  counts: number[];
};

export type StatsTagPercentResponse = {
  tags: string[];
  percentages: number[];
};

export type StatsTagCombosResponse = {
  combos: string[];
  counts: number[];
};

export type AdminSummaryResponse = {
  total_users: number;
  total_images: number;
  total_segmentations: number;
  total_tags: number;
  unassigned_images: number;
  verification: {
    unverified: number;
    ready_for_markup: number;
    markup_review: number;
    done: number;
  };
  roles: {
    owner: number;
    worker: number;
    guest: number;
  };
};

export type AdminUserListItem = {
  id: number;
  username: string;
  role: string;
  images: number;
  segmentations: number;
  assigned_images: number;
  activity_dates: string[];
  activity_counts: number[];
};

export type AdminUserDetailImage = {
  id: number;
  name: string;
  uploaded_at: string | null;
  segmentations: number;
  is_verified: number | null;
};

export type AdminUserDetailResponse = {
  id: number;
  username: string;
  role: string;
  images: AdminUserDetailImage[];
  activity_dates: string[];
  activity_counts: number[];
};

export type AdminTagsResponse = {
  items: Array<{
    id: number;
    name: string;
    images_count: number;
  }>;
};

type MeResponse = {
  user: CurrentUser;
};

type LoginResponse = {
  status: string;
  user: CurrentUser;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body instanceof FormData
      ? init.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        };

  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!response.ok) {
    throw response;
  }

  return (await response.json()) as T;
}

export function getCurrentUser(signal?: AbortSignal) {
  return request<MeResponse>("/api/auth/me", {
    method: "GET",
    signal,
  });
}

export function login(payload: {
  username: string;
  password: string;
}) {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getImages(searchParams: URLSearchParams, signal?: AbortSignal) {
  return request<ImagesResponse>(`/api/images?${searchParams.toString()}`, {
    method: "GET",
    signal,
  });
}

export function getImageDetail(imageId: number, signal?: AbortSignal) {
  return request<ImageDetailResponse>(`/api/images/${imageId}`, {
    method: "GET",
    signal,
  });
}

export function getTags(signal?: AbortSignal) {
  return request<TagsResponse>("/api/tags", {
    method: "GET",
    signal,
  });
}

export function getStatsOverview(signal?: AbortSignal) {
  return request<StatsOverviewResponse>("/api/stats/overview", {
    method: "GET",
    signal,
  });
}

export function getStatsTags(signal?: AbortSignal) {
  return request<StatsTagsResponse>("/api/stats/tags", {
    method: "GET",
    signal,
  });
}

export function getStatsTagPercent(signal?: AbortSignal) {
  return request<StatsTagPercentResponse>("/api/stats/tags-percent", {
    method: "GET",
    signal,
  });
}

export function getStatsTagCombos(signal?: AbortSignal) {
  return request<StatsTagCombosResponse>("/api/stats/tag-combos", {
    method: "GET",
    signal,
  });
}

export function getAdminSummary(signal?: AbortSignal) {
  return request<AdminSummaryResponse>("/api/admin/summary", {
    method: "GET",
    signal,
  });
}

export function getAdminUsers(signal?: AbortSignal) {
  return request<AdminUserListItem[]>("/api/admin/users", {
    method: "GET",
    signal,
  });
}

export function createAdminUser(payload: {
  username: string;
  password: string;
  role: string;
}) {
  return request<{ user: RelatedUser }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAdminUserDetail(userId: number, signal?: AbortSignal) {
  return request<AdminUserDetailResponse>(`/api/admin/users/${userId}`, {
    method: "GET",
    signal,
  });
}

export function getAdminTags(signal?: AbortSignal) {
  return request<AdminTagsResponse>("/api/admin/tags", {
    method: "GET",
    signal,
  });
}

export function createAdminTag(name: string) {
  return request<{ tag: AdminTagsResponse["items"][number] }>("/api/admin/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteAdminTag(tagId: number) {
  return request<{ status: string; tag_id: number }>(`/api/admin/tags/${tagId}`, {
    method: "DELETE",
  });
}

export function getImageEditor(imageId: number, signal?: AbortSignal) {
  return request<ImageEditorResponse>(`/api/images/${imageId}/editor`, {
    method: "GET",
    signal,
  });
}

export function updateImage(
  imageId: number,
  payload: {
    name: string;
    tags: string[];
  },
) {
  return request<{ image: ImageCard }>(`/api/images/${imageId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function assignImage(
  imageId: number,
  assignedUserId: number | null,
) {
  return request<{ image: ImageCard }>(`/api/images/${imageId}/assignee`, {
    method: "PUT",
    body: JSON.stringify({
      assigned_user_id: assignedUserId,
    }),
  });
}

export function verifyImage(
  imageId: number,
  status: number,
) {
  return request<{ image: ImageCard }>(`/api/images/${imageId}/verify`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function deleteImage(imageId: number) {
  return request<{ status: string; redirect_url: string }>(`/api/images/${imageId}`, {
    method: "DELETE",
  });
}

export function getSegmentations(imageId: number, signal?: AbortSignal) {
  return request<SegmentationMap>(`/api/images/${imageId}/segmentations`, {
    method: "GET",
    signal,
  });
}

export function saveSegmentation(
  imageId: number,
  label: string,
  lines: Array<Array<{ x: number; y: number }>>,
) {
  return request<{ status: string; label: string; lines: Array<Array<{ x: number; y: number }>> }>(
    `/api/images/${imageId}/segmentations/${encodeURIComponent(label)}`,
    {
      method: "PUT",
      body: JSON.stringify({ lines }),
    },
  );
}

export function removeSegmentation(imageId: number, label: string) {
  return request<{ status: string; label: string }>(
    `/api/images/${imageId}/segmentations/${encodeURIComponent(label)}`,
    {
      method: "DELETE",
    },
  );
}

export function uploadImage(formData: FormData) {
  return request<UploadImageResponse>("/api/images", {
    method: "POST",
    body: formData,
  });
}

export function predictTags(formData: FormData) {
  return request<PredictTagsResponse>("/api/predict", {
    method: "POST",
    body: formData,
  });
}

export async function logout() {
  await request<{ status: string }>("/api/auth/logout", {
    method: "POST",
  });
}
