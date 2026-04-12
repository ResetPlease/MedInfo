from typing import cast

from fastapi import APIRouter, Depends
from fastapi.exceptions import HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Image, ImageTag, Segmentation, Tag, User, allRoles, Role, isModelAdmin
from app.security import get_current_user_api
from app.services import (
    STATUS_DONE,
    STATUS_MARKUP_REVIEW,
    STATUS_READY_FOR_MARKUP,
    STATUS_TAGS_PENDING,
)

router = APIRouter()


class CreateTagPayload(BaseModel):
    name: str


class CreateUserPayload(BaseModel):
    username: str
    password: str
    role: str = Role.WORKER.value


def require_admin_api(current_user: User) -> User:
    if not isModelAdmin(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return current_user


def serialize_admin_user(db: Session, user: User) -> dict:
    activity_data = (
        db.query(
            func.date(Image.uploaded_at).label("date"),
            func.count(Image.id)
        )
        .filter(Image.author_id == user.id)
        .group_by(func.date(Image.uploaded_at))
        .order_by(func.date(Image.uploaded_at))
        .all()
    )

    segmentations_count = (
        db.query(func.count(Segmentation.id))
        .join(Image, Segmentation.image_id == Image.id)
        .filter(Image.author_id == user.id)
        .scalar()
    )

    assigned_images_count = (
        db.query(func.count(Image.id))
        .filter(Image.assigned_user_id == user.id)
        .scalar()
    )

    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "images": len(user.images),
        "segmentations": int(segmentations_count or 0),
        "assigned_images": int(assigned_images_count or 0),
        "activity_dates": [str(a.date) for a in activity_data],
        "activity_counts": [a[1] for a in activity_data],
    }


def create_user_record(
    username: str,
    password: str,
    role: str,
    db: Session,
) -> User:
    normalized_username = username.strip()
    if not normalized_username:
        raise HTTPException(status_code=400, detail="Логин не может быть пустым")

    if not password:
        raise HTTPException(status_code=400, detail="Пароль не может быть пустым")

    normalized_role = role if role in allRoles() else Role.WORKER.value

    if db.query(User).filter(User.username == normalized_username).first():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")

    try:
        from passlib.hash import bcrypt

        password_hash = bcrypt.hash(password)
    except Exception:
        password_hash = password

    user = User(username=normalized_username, password_hash=password_hash, role=normalized_role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/api/admin/users")
async def get_admin_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)
    users = db.query(User).all()
    return [serialize_admin_user(db, user) for user in users]


@router.post("/api/admin/users")
async def create_admin_user_api(
    payload: CreateUserPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)
    user = create_user_record(
        username=payload.username,
        password=payload.password,
        role=payload.role,
        db=db,
    )
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
        }
    }


@router.get("/api/admin/users/{user_id}")
async def get_user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    activity_data = (
        db.query(
            func.date(Image.uploaded_at).label("date"),
            func.count(Image.id)
        )
        .filter(Image.author_id == user.id)
        .group_by(func.date(Image.uploaded_at))
        .order_by(func.date(Image.uploaded_at))
        .all()
    )

    activity_dates = [
        "-" if d.date is None else d.date if isinstance(
            d.date, str) else d.date.strftime("%Y-%m-%d")
        for d in activity_data
    ]
    activity_counts = [d[1] for d in activity_data]

    images = [
        {
            "id": img.id,
            "name": img.name,
            "uploaded_at": img.uploaded_at.isoformat() if img.uploaded_at else None,
            "segmentations": len(img.segmentations),
            "is_verified": img.is_verified,
        }
        for img in user.images
    ]

    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "images": images,
        "activity_dates": activity_dates,
        "activity_counts": activity_counts,
    }


@router.get("/api/admin/summary")
async def get_admin_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)

    total_users = db.query(func.count(User.id)).scalar()
    total_images = db.query(func.count(Image.id)).scalar()
    total_segmentations = db.query(func.count(Segmentation.id)).scalar()
    total_tags = db.query(func.count(Tag.id)).scalar()

    role_rows = db.query(User.role, func.count(User.id)).group_by(User.role).all()
    role_distribution = {cast(str, role): count for role, count in role_rows}

    unassigned_images = db.query(func.count(Image.id)).filter(Image.assigned_user_id.is_(None)).scalar()
    unverified_images = db.query(func.count(Image.id)).filter(or_(Image.is_verified == STATUS_TAGS_PENDING, Image.is_verified.is_(None))).scalar()
    ready_for_markup_images = db.query(func.count(Image.id)).filter(Image.is_verified == STATUS_READY_FOR_MARKUP).scalar()
    markup_review_images = db.query(func.count(Image.id)).filter(Image.is_verified == STATUS_MARKUP_REVIEW).scalar()
    done_images = db.query(func.count(Image.id)).filter(Image.is_verified == STATUS_DONE).scalar()

    return {
        "total_users": int(total_users or 0),
        "total_images": int(total_images or 0),
        "total_segmentations": int(total_segmentations or 0),
        "total_tags": int(total_tags or 0),
        "unassigned_images": int(unassigned_images or 0),
        "verification": {
            "unverified": int(unverified_images or 0),
            "ready_for_markup": int(ready_for_markup_images or 0),
            "markup_review": int(markup_review_images or 0),
            "done": int(done_images or 0),
        },
        "roles": {
            "owner": int(role_distribution.get(Role.ADMIN.value, 0)),
            "worker": int(role_distribution.get(Role.WORKER.value, 0)),
            "guest": int(role_distribution.get(Role.GUEST.value, 0)),
        },
    }


@router.get("/api/admin/tags")
async def get_admin_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)

    tags = (
        db.query(
            Tag.id,
            Tag.name,
            func.count(ImageTag.id).label("images_count"),
        )
        .outerjoin(ImageTag, ImageTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(Tag.name.asc())
        .all()
    )

    return {
        "items": [
            {
                "id": tag.id,
                "name": tag.name,
                "images_count": int(tag.images_count or 0),
            }
            for tag in tags
        ]
    }


@router.post("/api/admin/tags")
async def create_admin_tag(
    payload: CreateTagPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название тега не может быть пустым")

    exists = db.query(Tag).filter(func.lower(Tag.name) == name.lower()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Тег уже существует")

    tag = Tag(name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)

    return {
        "tag": {
            "id": tag.id,
            "name": tag.name,
            "images_count": 0,
        }
    }


@router.delete("/api/admin/tags/{tag_id}")
async def delete_admin_tag_api(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    require_admin_api(current_user)

    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")

    tag_name = tag.name
    images = db.query(Image).filter(Image.tags.isnot(None)).all()
    for image in images:
        if not image.tags:
            continue
        parts = [part.strip() for part in image.tags.split(",") if part.strip()]
        updated_parts = [part for part in parts if part != tag_name]
        if len(updated_parts) != len(parts):
            image.tags = ",".join(updated_parts)

    db.query(ImageTag).filter(ImageTag.tag_id == tag.id).delete(synchronize_session=False)
    db.delete(tag)
    db.commit()

    return {"status": "ok", "tag_id": tag_id}
