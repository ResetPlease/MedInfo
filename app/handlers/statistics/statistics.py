from collections import Counter
from itertools import combinations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Image, User
from app.security import get_current_user_api
from app.services import (
    STATUS_DONE,
    STATUS_MARKUP_REVIEW,
    STATUS_READY_FOR_MARKUP,
    STATUS_TAGS_PENDING,
)

router = APIRouter()


@router.get("/api/stats/tags")
async def stats_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    images = db.query(Image).all()
    counter = Counter()
    for img in images:
        for tag in (img.tags or "").split(","):
            counter[tag.strip()] += 1
    counter.pop("", None)
    return {"tags": list(counter.keys()), "counts": list(counter.values())}


@router.get("/api/stats/tags-percent")
async def stats_tags_percent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    images = db.query(Image).all()
    tag_count = Counter()
    total_tags = 0
    for img in images:
        tags = [t.strip() for t in (img.tags or "").split(",") if t.strip()]
        for t in tags:
            tag_count[t] += 1
            total_tags += 1
    percentages = {
        tag: (count / total_tags * 100)
        for tag, count in tag_count.items()
    } if total_tags else {}
    return {"tags": list(percentages.keys()), "percentages": list(percentages.values())}


@router.get("/api/stats/tag-combos")
async def stats_tag_combos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    images = db.query(Image).all()
    combo_count = Counter()
    for img in images:
        tags = sorted(set(t.strip() for t in (img.tags or "").split(",") if t.strip()))
        if len(tags) >= 2:
            for combo in combinations(tags, 2):
                combo_count[combo] += 1
    top_combos = combo_count.most_common(5)  # топ-10 сочетаний
    return {
        "combos": [f"{a} + {b}" for a, b in dict(top_combos).keys()],
        "counts": list(dict(top_combos).values()),
    }


@router.get("/api/stats/overview")
async def stats_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    images = db.query(Image).all()

    total_images = len(images)
    verified_counts = {
        "unverified": 0,
        "ready_for_markup": 0,
        "markup_review": 0,
        "done": 0,
        "unknown": 0,
    }
    unassigned_images = 0
    tags_counter = Counter()
    total_tag_links = 0

    for image in images:
        if image.is_verified == STATUS_TAGS_PENDING:
            verified_counts["unverified"] += 1
        elif image.is_verified == STATUS_READY_FOR_MARKUP:
            verified_counts["ready_for_markup"] += 1
        elif image.is_verified == STATUS_MARKUP_REVIEW:
            verified_counts["markup_review"] += 1
        elif image.is_verified == STATUS_DONE:
            verified_counts["done"] += 1
        else:
            verified_counts["unknown"] += 1

        if not image.assigned_user_id:
            unassigned_images += 1

        tags = [tag.strip() for tag in (image.tags or "").split(",") if tag.strip()]
        total_tag_links += len(tags)
        for tag in tags:
            tags_counter[tag] += 1

    top_tag_name = None
    top_tag_count = 0
    if tags_counter:
        top_tag_name, top_tag_count = tags_counter.most_common(1)[0]

    average_tags_per_image = (total_tag_links / total_images) if total_images else 0
    verification_completion = (
        verified_counts["done"] / total_images * 100
        if total_images else 0
    )

    return {
        "total_images": total_images,
        "unique_tags": len(tags_counter),
        "total_tag_links": total_tag_links,
        "average_tags_per_image": average_tags_per_image,
        "unassigned_images": unassigned_images,
        "verified_counts": verified_counts,
        "verification_completion": verification_completion,
        "top_tag": {
            "name": top_tag_name,
            "count": top_tag_count,
        },
    }
