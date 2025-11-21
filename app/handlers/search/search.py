from sqlalchemy.orm import Session
from sqlalchemy import func

from fastapi.responses import (
    HTMLResponse,
)

from fastapi.templating import Jinja2Templates
from fastapi import Depends, Request, Query, APIRouter
from app.models import User, Image, isModelAdmin, at_least_worker
from app.security import get_current_user
from app.database import get_db
from typing import List, Optional, cast

import re

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def parse_search_query(query: str):
    query = query.strip()

    id_filters = []
    id_matches = re.findall(r"id\s*([<>=]{1,2})\s*(\d+)", query)
    for op, val in id_matches:
        id_filters.append((op, int(val)))

    id_colon = re.findall(r"id:(\d+)", query)
    for val in id_colon:
        id_filters.append(("=", int(val)))

    # --- NEW: count filters ---
    count_filters = []
    count_matches = re.findall(r"count\s*([<>=]{1,2})\s*(\d+)", query)
    for op, val in count_matches:
        count_filters.append((op, int(val)))

    # assignee:username или assigned:username или user:username
    assignee_filters = re.findall(r"(?:assignee|assigned|user):([^\s]+)", query)
    assignee_filters = [a.lower() for a in assignee_filters]

    tags = re.findall(r"tag:([^\s]+)", query)
    tags = [t.lower() for t in tags]

    cleaned_query = (
        re.sub(
            r"(id\s*[<>=]{1,2}\s*\d+|id:\d+|count\s*[<>=]{1,2}\s*\d+|tag:[^\s]+|(assignee|assigned|user):[^\s]+)",
            "",
            query,
        )
        .strip()
        .lower()
    )

    return {
        "id_filters": id_filters,
        "count_filters": count_filters,  # добавляем
        "tags": tags,
        "text_query": cleaned_query,
        "assignees": assignee_filters,
    }


def apply_search_filters(images: List, search_params: dict):
    results = images

    # --- фильтр по ID ---
    for op, val in search_params["id_filters"]:
        if op == "=":
            results = [img for img in results if img.id == val]
        elif op == ">":
            results = [img for img in results if img.id > val]
        elif op == "<":
            results = [img for img in results if img.id < val]
        elif op == ">=":
            results = [img for img in results if img.id >= val]
        elif op == "<=":
            results = [img for img in results if img.id <= val]

    # --- фильтр по Count ---
    for op, val in search_params["count_filters"]:
        if op == "=":
            results = [img for img in results if len(
                img.tags.split(",")) == val]
        elif op == ">":
            results = [img for img in results if len(
                img.tags.split(",")) > val]
        elif op == "<":
            results = [img for img in results if len(
                img.tags.split(",")) < val]
        elif op == ">=":
            results = [img for img in results if len(
                img.tags.split(",")) >= val]
        elif op == "<=":
            results = [img for img in results if len(
                img.tags.split(",")) <= val]

    # --- фильтр по тегам ---
    for tag in search_params["tags"]:
        results = [img for img in results if tag in img.tags.lower().split(",")]

    # --- фильтр по назначенному пользователю ---
    for assignee in search_params.get("assignees", []):
        results = [
            img for img in results
            if img.assigned_user and cast(str, img.assigned_user.username).lower() == assignee
        ]

    # --- текстовый поиск ---
    text = search_params["text_query"]
    if text:

        def fuzzy_match(img):
            candidates = [img.name.lower()] + img.tags.lower().split(",")
            if img.assigned_user and img.assigned_user.username:
                candidates.append(img.assigned_user.username.lower())
            for c in candidates:
                if text.lower() in c:
                    return True
            return False

        results = [img for img in results if fuzzy_match(img)]

    return results


@router.get("/search", response_class=HTMLResponse)
async def search_images(
    request: Request,
    search: str = "",
    page: int = 1,
    limit: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    unverified: bool = Query(False),
    status: Optional[int] = Query(None),
    mine: bool = Query(False),
):
    query = db.query(Image)

    if mine:
        query = query.filter(Image.assigned_user_id == current_user.id)

    if status is not None:
        query = query.filter(Image.is_verified == status)
    elif unverified and isModelAdmin(current_user):
        query = query.filter((Image.is_verified == False) | (Image.is_verified.is_(None)))

    all_images = query.all()

    if search:
        search_params = parse_search_query(search)
        filtered_images = apply_search_filters(all_images, search_params)
    else:
        filtered_images = all_images

    total = len(filtered_images)
    from_search = min(len(filtered_images) - 1, (page - 1) * limit)
    end_search = min(from_search + limit, len(filtered_images))
    images = filtered_images[from_search:end_search]
    total_pages = total // limit
    if total % limit != 0:
        total_pages += 1

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "images": images,
            "search": search,
            "page": page,
            "total_pages": total_pages,
            "at_least_worker": at_least_worker,
            "isModelAdmin": isModelAdmin,
            "unverified": bool(unverified and isModelAdmin(current_user)),
            "status": status,
            "mine": mine,
            "found_total": total,
        },
    )
