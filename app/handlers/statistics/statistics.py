from collections import Counter
from itertools import combinations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Image, User, at_least_worker
from app.security import get_current_user

templates = Jinja2Templates(directory="app/templates")
router = APIRouter()


@router.get("/api/stats/tags")
async def stats_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    images = db.query(Image).all()
    counter = Counter()
    for img in images:
        for tag in img.tags.split(","):
            counter[tag.strip()] += 1
    return {"tags": list(counter.keys()), "counts": list(counter.values())}


@router.get("/api/stats/tags-percent")
async def stats_tags_percent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    images = db.query(Image).all()
    tag_count = Counter()
    total_tags = 0
    for img in images:
        tags = [t.strip() for t in img.tags.split(",") if t.strip()]
        for t in tags:
            tag_count[t] += 1
            total_tags += 1
    percentages = {tag: (count / total_tags * 100)
                   for tag, count in tag_count.items()}
    return {"tags": list(percentages.keys()), "percentages": list(percentages.values())}


@router.get("/api/stats/tag-combos")
async def stats_tag_combos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    images = db.query(Image).all()
    combo_count = Counter()
    for img in images:
        tags = sorted(set(t.strip() for t in img.tags.split(",") if t.strip()))
        if len(tags) >= 2:
            for combo in combinations(tags, 2):
                combo_count[combo] += 1
    top_combos = combo_count.most_common(5)  # топ-10 сочетаний
    return {
        "combos": [f"{a} + {b}" for a, b in dict(top_combos).keys()],
        "counts": list(dict(top_combos).values()),
    }


@router.get("/stats", response_class=HTMLResponse)
async def stats_page(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(Image.id)).scalar()
    return templates.TemplateResponse(
        "stats.html", {"request": request, "total_images": total,
                       "at_least_worker": at_least_worker}
    )
