import os
from datetime import datetime
from shutil import copyfileobj
from typing import List

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import Image, ImageTag, Tag, User
from app.services.image_authors import register_image_author
from app.services.image_status import STATUS_TAGS_PENDING

UPLOAD_DIR = "app/uploads"
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}


def get_tag_names(db: Session) -> List[str]:
    return [tag.name for tag in db.query(Tag).order_by(Tag.name.asc()).all()]


def create_image(
    db: Session,
    current_user: User,
    file: UploadFile,
    name: str,
    tags: List[str],
) -> Image:
    normalized_tags = _normalize_tags(tags)
    _validate_tags(db, normalized_tags)

    file_extension = _get_file_extension(file)
    if file_extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Допустимы только файлы .jpg, .jpeg, .png",
        )

    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        copyfileobj(file.file, buffer)

    image = Image(
        name=name,
        file_path=f"/uploads/{filename}",
        tags=",".join(normalized_tags),
        author_id=current_user.id,
        is_verified=STATUS_TAGS_PENDING,
    )
    db.add(image)
    db.flush()
    register_image_author(db, image, current_user)

    _sync_image_tags(db, image, normalized_tags)

    db.commit()
    db.refresh(image)

    return image


def get_tags_by_names(db: Session, tag_names: List[str]) -> List[Tag]:
    normalized = _normalize_tags(tag_names)
    if not normalized:
        return []

    return db.query(Tag).filter(Tag.name.in_(normalized)).all()


def sync_image_tags(db: Session, image: Image, tag_names: List[str]) -> None:
    _sync_image_tags(db, image, _normalize_tags(tag_names))


def _normalize_tags(tag_names: List[str]) -> List[str]:
    return [tag.strip() for tag in tag_names if tag and tag.strip()]


def _validate_tags(db: Session, tag_names: List[str]) -> None:
    existing_names = {tag.name for tag in get_tags_by_names(db, tag_names)}
    invalid_tags = [tag for tag in tag_names if tag not in existing_names]
    if invalid_tags:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимые теги: {invalid_tags}",
        )


def _get_file_extension(file: UploadFile) -> str:
    if not file.filename or "." not in file.filename:
        return ""

    return file.filename.rsplit(".", 1)[-1].lower()


def _sync_image_tags(db: Session, image: Image, tag_names: List[str]) -> None:
    tags = get_tags_by_names(db, tag_names)
    current_ids = {link.tag_id for link in image.tag_links}
    wanted_ids = {tag.id for tag in tags}

    for link in list(image.tag_links):
        if link.tag_id not in wanted_ids:
            db.delete(link)

    for tag in tags:
        if tag.id not in current_ids:
            db.add(ImageTag(image_id=image.id, tag_id=tag.id))
