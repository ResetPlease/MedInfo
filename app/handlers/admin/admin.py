from typing import cast, Annotated

from fastapi import APIRouter, Depends, Form, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Image, ImageTag, Tag, User, allRoles, Role
from app.security import MinRoleRequired

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/admin/tags", response_class=HTMLResponse)
async def tags_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    tags = db.query(Tag).order_by(Tag.name.asc()).all()
    return templates.TemplateResponse("tags.html", {"request": request, "tags": tags})


@router.post("/admin/tags")
async def create_tag(
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    name = name.strip()
    if not name:
        raise HTTPException(
            status_code=400, detail="Название тега не может быть пустым")
    exists = db.query(Tag).filter(func.lower(Tag.name) == name.lower()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Тег уже существует")
    db.add(Tag(name=name))
    db.commit()
    return RedirectResponse(url="/admin/tags", status_code=303)


@router.post("/admin/tags/{tag_id}/delete")
async def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")
    # Имя тега до удаления
    tag_name = tag.name

    # 1) Удаляем тег из legacy-строки Image.tags для всех изображений
    images = db.query(Image).filter(Image.tags.isnot(None)).all()
    for img in images:
        if not img.tags:
            continue
        parts = [p.strip() for p in img.tags.split(",") if p.strip()]
        new_parts = [p for p in parts if p != tag_name]
        if len(new_parts) != len(parts):
            img.tags = ",".join(new_parts)

    # 2) Удаляем связи image_tags явно, затем сам тег
    db.query(ImageTag).filter(ImageTag.tag_id ==
                              tag.id).delete(synchronize_session=False)
    db.delete(tag)
    db.commit()
    return RedirectResponse(url="/admin/tags", status_code=303)


@router.get("/admin/users", response_class=HTMLResponse)
async def create_user_page(
    request: Request,
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):
    return templates.TemplateResponse("register.html", {"request": request, "roles" : allRoles()})


@router.post("/admin/users")
async def create_user(
    username: str = Form(...),
    password: str = Form(...),
    role: str = Form(Role.WORKER.value),
    db: Session = Depends(get_db),
    current_user: User = Depends(MinRoleRequired(Role.ADMIN)),
):  
    role = role if role in allRoles() else Role.WORKER.value

    # Проверка уникальности
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(
            status_code=400, detail="Пользователь уже существует")

    try:
        from passlib.hash import bcrypt

        password_hash = bcrypt.hash(password)
    except Exception:
        password_hash = password

    user = User(username=username, password_hash=password_hash, role=role)
    db.add(user)
    db.commit()

    return RedirectResponse(url="/admin/users", status_code=303)
