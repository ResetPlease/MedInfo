import os
from datetime import datetime
from shutil import copyfileobj
from typing import List, cast

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Request,
                     UploadFile)
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Image, ImageTag, Tag, User, Role, isModelAdmin, at_least_worker
from app.security import get_current_user, MinRoleRequired

router = APIRouter()

templates = Jinja2Templates(directory="app/templates")


@router.get("/image_editor", response_class=HTMLResponse)
async def image_editor(
    request: Request,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.WORKER)),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    tags = cast(str, image.tags)
    tag_names = tags.split(",") if tags else []

    return templates.TemplateResponse(
        "image_editor.html",
        {"request": request, "image": image, "tags": tag_names},
    )


@router.get("/image/{image_id}", response_class=HTMLResponse)
async def image_detail(
    request: Request,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    tag_names = [t.name for t in db.query(Tag).order_by(Tag.name.asc()).all()]
    prev_image = db.query(Image).filter(
        Image.id < image.id).order_by(Image.id.desc()).first()
    if not prev_image:
        prev_image = Image(id=0)
    next_image = db.query(Image).filter(
        Image.id > image.id).order_by(Image.id.asc()).first()
    if not next_image:
        next_image = Image(id=0)
    return templates.TemplateResponse(
        "image_detail.html",
        {"request": request, "image": image, "tags": tag_names,
            "prev_id": prev_image.id, "next_id": next_image.id,
            "isModelAdmin": isModelAdmin,
            "at_least_worker":at_least_worker},
    )


@router.post("/image/{image_id}/delete", response_class=RedirectResponse)
async def delete_image(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    # delete from uploads
    file_path = f"app{image.file_path}"
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete(image)
    db.commit()

    return RedirectResponse(url="/", status_code=303)


@router.post("/image/{image_id}/update", response_class=RedirectResponse)
async def update_image(
    image_id: int,
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.WORKER)),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    # Проверка тегов по базе
    existing_names = {t.name for t in _get_tags_by_names(db, tags)}
    invalid_tags = [tag for tag in tags if tag not in existing_names]
    if invalid_tags:
        raise HTTPException(
            status_code=400, detail=f"Недопустимые теги: {invalid_tags}")

    image.name = name
    image.tags = ",".join(tags)

    _sync_image_tags(db, image, tags)

    db.commit()

    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


@router.post("/image/{image_id}/verify", response_class=RedirectResponse)
async def verify_image(
    image_id: int,
    status: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    # not ver, ready to mark, full ver
    verified_statuses = [0, 1, 2]
    if status not in verified_statuses:
        raise HTTPException(
            status_code=404, detail="Неверный тип подтверждения")

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    image.is_verified = status
    db.commit()
    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.WORKER)),
):

    # tags checking
    existing_names = {t.name for t in _get_tags_by_names(db, tags)}
    invalid_tags = [tag for tag in tags if tag not in existing_names]
    if invalid_tags:
        raise HTTPException(
            status_code=400, detail=f"Недопустимые теги: {invalid_tags}")

    # Сохранение файла
    file_extension = file.filename.split(".")[-1]
    if file_extension.lower() not in ["jpg", "jpeg", "png"]:
        raise HTTPException(
            status_code=400, detail="Допустимы только файлы .jpg, .jpeg, .png"
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    file_path = f"app/uploads/{filename}"

    with open(file_path, "wb") as buffer:
        copyfileobj(file.file, buffer)

    image = Image(
        name=name,
        file_path=f"/uploads/{filename}",
        tags=",".join(tags),  # legacy
        author_id=current_user.id,
        is_verified=False,
    )
    db.add(image)
    db.flush()

    _sync_image_tags(db, image, tags)

    db.commit()
    db.refresh(image)

    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


# Helper function for tag management
def _get_tags_by_names(db: Session, tag_names: List[str]) -> List[Tag]:
    normalized = [t.strip() for t in tag_names if t and t.strip()]
    if not normalized:
        return []
    return db.query(Tag).filter(Tag.name.in_(normalized)).all()


def _sync_image_tags(db: Session, image: Image, tag_names: List[str]):
    tags = _get_tags_by_names(db, tag_names)
    current_ids = {link.tag_id for link in image.tag_links}
    wanted_ids = {t.id for t in tags}

    # Удаляем лишние
    for link in list(image.tag_links):
        if link.tag_id not in wanted_ids:
            db.delete(link)

    # Добавляем недостающие
    for t in tags:
        if t.id not in current_ids:
            db.add(ImageTag(image_id=image.id, tag_id=t.id))
