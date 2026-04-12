from dataclasses import dataclass
import re
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from app.models import Image, User, at_least_worker, isModelAdmin
from app.services.image_status import STATUS_TAGS_PENDING

_QUOTED_FILTER_VALUE_PATTERN = r"(?:\"[^\"]+\"|(?!\")[^\s]+)"


@dataclass
class ImageListParams:
    page: int = 1
    limit: int = 12
    search: str = ""
    unverified: bool = False
    status: Optional[int] = None
    mine: bool = False


def get_image_listing(
    db: Session,
    current_user: User,
    params: ImageListParams,
) -> dict[str, Any]:
    page = max(1, params.page)
    limit = min(max(1, params.limit), 100)
    base_query = _build_base_query(
        db=db,
        current_user=current_user,
        mine=params.mine,
        status=params.status,
        unverified=params.unverified,
    )

    if params.search.strip():
        all_images = base_query.all()
        filtered_images = _apply_search_filters(
            all_images,
            _parse_search_query(params.search),
        )
        total = len(filtered_images)
        start = (page - 1) * limit
        end = start + limit
        images = filtered_images[start:end]
    else:
        total = base_query.with_entities(func.count(Image.id)).scalar() or 0
        images = base_query.offset((page - 1) * limit).limit(limit).all()

    total_pages = (total + limit - 1) // limit if total else 0

    return {
        "images": images,
        "page": page,
        "limit": limit,
        "total": total,
        "total_pages": total_pages,
        "search": params.search,
        "status": params.status,
        "mine": params.mine,
        "unverified": bool(params.unverified and isModelAdmin(current_user)),
    }


def serialize_current_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "permissions": {
            "is_admin": isModelAdmin(user),
            "at_least_worker": at_least_worker(user),
        },
    }


def serialize_image_card(image: Image, current_user: User) -> dict[str, Any]:
    tags = _split_tags(image.tags)

    return {
        "id": image.id,
        "name": image.name or f"image-{image.id}",
        "file_path": image.file_path,
        "tags": tags,
        "tags_display": ", ".join(tags),
        "is_verified": image.is_verified,
        "uploaded_at": image.uploaded_at.isoformat() if image.uploaded_at else None,
        "author": _serialize_related_user(image.author),
        "assigned_user": _serialize_related_user(image.assigned_user),
        "assigned_to_current_user": bool(
            image.assigned_user and image.assigned_user.id == current_user.id
        ),
    }


def _build_base_query(
    db: Session,
    current_user: User,
    mine: bool,
    status: Optional[int],
    unverified: bool,
) -> Query:
    query = db.query(Image)

    if mine:
        query = query.filter(Image.assigned_user_id == current_user.id)

    if status is not None:
        return query.filter(Image.is_verified == status)

    if unverified and isModelAdmin(current_user):
        return query.filter(
            (Image.is_verified == STATUS_TAGS_PENDING) | (Image.is_verified.is_(None))
        )

    return query


def _parse_search_query(query: str) -> dict[str, Any]:
    raw_query = query.strip()

    id_filters = []
    id_matches = re.findall(r"id\s*([<>=]{1,2})\s*(\d+)", raw_query)
    for op, value in id_matches:
        id_filters.append((op, int(value)))

    id_colon = re.findall(r"id:(\d+)", raw_query)
    for value in id_colon:
        id_filters.append(("=", int(value)))

    count_filters = []
    count_matches = re.findall(r"count\s*([<>=]{1,2})\s*(\d+)", raw_query)
    for op, value in count_matches:
        count_filters.append((op, int(value)))

    assignee_filters = _extract_named_values(
        raw_query,
        rf"(?:assignee|assigned|user):({_QUOTED_FILTER_VALUE_PATTERN})",
    )
    assignees = [assignee.lower() for assignee in assignee_filters]

    tags = _extract_named_values(raw_query, rf"tag:({_QUOTED_FILTER_VALUE_PATTERN})")
    normalized_tags = [tag.lower() for tag in tags]

    text_query = re.sub(
        rf"(id\s*[<>=]{{1,2}}\s*\d+|id:\d+|count\s*[<>=]{{1,2}}\s*\d+|tag:{_QUOTED_FILTER_VALUE_PATTERN}|(?:assignee|assigned|user):{_QUOTED_FILTER_VALUE_PATTERN})",
        "",
        raw_query,
    ).strip().lower()

    return {
        "id_filters": id_filters,
        "count_filters": count_filters,
        "tags": normalized_tags,
        "text_query": text_query,
        "assignees": assignees,
    }


def _apply_search_filters(images: list[Image], search_params: dict[str, Any]) -> list[Image]:
    results = images

    for op, value in search_params["id_filters"]:
        if op == "=":
            results = [image for image in results if image.id == value]
        if op == ">":
            results = [image for image in results if image.id > value]
        if op == "<":
            results = [image for image in results if image.id < value]
        if op == ">=":
            results = [image for image in results if image.id >= value]
        if op == "<=":
            results = [image for image in results if image.id <= value]

    for op, value in search_params["count_filters"]:
        if op == "=":
            results = [image for image in results if len(_split_tags(image.tags)) == value]
        if op == ">":
            results = [image for image in results if len(_split_tags(image.tags)) > value]
        if op == "<":
            results = [image for image in results if len(_split_tags(image.tags)) < value]
        if op == ">=":
            results = [image for image in results if len(_split_tags(image.tags)) >= value]
        if op == "<=":
            results = [image for image in results if len(_split_tags(image.tags)) <= value]

    for tag in search_params["tags"]:
        results = [
            image for image in results if tag in [item.lower() for item in _split_tags(image.tags)]
        ]

    for assignee in search_params["assignees"]:
        results = [
            image
            for image in results
            if image.assigned_user and image.assigned_user.username.lower() == assignee
        ]

    text_query = search_params["text_query"]
    if not text_query:
        return results

    return [image for image in results if _matches_text_query(image, text_query)]


def _matches_text_query(image: Image, text_query: str) -> bool:
    candidates = [(image.name or "").lower(), *_split_tags(image.tags, lower=True)]

    if image.assigned_user and image.assigned_user.username:
        candidates.append(image.assigned_user.username.lower())

    return any(text_query in candidate for candidate in candidates)


def _serialize_related_user(user: Optional[User]) -> Optional[dict[str, Any]]:
    if not user:
        return None

    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
    }


def _split_tags(tags: Optional[str], lower: bool = False) -> list[str]:
    if not tags:
        return []

    normalized = [tag.strip() for tag in tags.split(",") if tag.strip()]
    if not lower:
        return normalized

    return [tag.lower() for tag in normalized]


def _extract_named_values(raw_query: str, pattern: str) -> list[str]:
    matches = re.findall(pattern, raw_query)
    values = []

    for match in matches:
        normalized = match.strip()
        if len(normalized) >= 2 and normalized[0] == '"' and normalized[-1] == '"':
            normalized = normalized[1:-1]

        if normalized:
            values.append(normalized)

    return values
