from fastapi import (
    FastAPI,
    File,
    UploadFile,
    Form,
    HTTPException,
    Depends,
    Request,
    Security,
    Query,
)
from pathlib import Path
from fastapi.templating import Jinja2Templates
from fastapi.responses import (
    HTMLResponse,
    RedirectResponse,
    StreamingResponse,
    Response,
    FileResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
import os
import shutil
import json
import zipfile
from io import BytesIO
from typing import List
from datetime import datetime
from .database import SessionLocal, init_db
from .models import Image, User, Tag, ImageTag, Segmentation
import re
from collections import Counter
from itertools import combinations
import io
from PIL import Image as Img
import sys
import os
from .inference import predict_wrinkles


app = FastAPI()
templates = Jinja2Templates(directory="app/templates")

# Теги теперь берём из базы (см. Tag)

security = HTTPBasic()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    credentials: HTTPBasicCredentials = Security(security),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == credentials.username).first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Неверный логин или пароль",
            headers={"WWW-Authenticate": "Basic"},
        )

    # Проверяем bcrypt-хеш; при неудаче пробуем прямое сравнение (для обратной совместимости)
    verified = False
    try:
        from passlib.hash import bcrypt

        if user.password_hash and bcrypt.identify(user.password_hash):
            verified = bcrypt.verify(credentials.password, user.password_hash)
        else:
            verified = credentials.password == user.password_hash
    except Exception:
        verified = credentials.password == user.password_hash

    if not verified:
        raise HTTPException(
            status_code=401,
            detail="Неверный логин или пароль",
            headers={"WWW-Authenticate": "Basic"},
        )
    # Прокидываем текущего пользователя в request.state для шаблонов
    try:
        request.state.current_user = user
    except Exception:
        pass
    return user


# Создание базы данных при старте
init_db()


UPLOAD_DIR = "app/uploads/predict"


@app.post("/segmentations/{image_id}/{label}")
def save_segmentation(
    image_id: int,
    label: str,
    data: List[List[dict]],
    db: Session = Depends(get_db)
):
    seg = db.query(Segmentation).filter_by(image_id=image_id, label=label).first()
    if seg:
        seg.data = data
    else:
        seg = Segmentation(image_id=image_id, label=label, data=data)
        db.add(seg)
    db.commit()
    return {"status": "ok"}


@app.delete("/segmentations/{image_id}/{label}")
def delete_segmentation(image_id: int, label: str, db: Session = Depends(get_db)):
    seg = db.query(Segmentation).filter_by(image_id=image_id, label=label).first()
    if seg:
        db.delete(seg)
        db.commit()
    return {"status": "deleted"}


@app.get("/segmentations/{image_id}")
def get_segmentations(image_id: int, db: Session = Depends(get_db)):
    segs = db.query(Segmentation).filter_by(image_id=image_id).all()
    return {seg.label: seg.data for seg in segs}


@app.get("/image_editor", response_class=HTMLResponse)
async def image_editor(
    request: Request,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    tag_names = image.tags.split(",") if image.tags else []

    return templates.TemplateResponse(
        "image_editor.html",
        {"request": request, "image": image, "tags": tag_names},
    )


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if not os.path.exists(UPLOAD_DIR):
        os.mkdir(UPLOAD_DIR)
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    labels = predict_wrinkles(file_path)
    return {"wrinkles": labels}


@app.get("/predict")
async def predict_template(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        "predict.html",
        {"request": request},
    )

@app.post("/logout")
async def logout():
    # Провоцируем браузер забыть Basic-Auth, отдав 401 и заголовок WWW-Authenticate
    raise HTTPException(
        status_code=401,
        detail="Вы вышли из системы",
        headers={"WWW-Authenticate": "Basic"},
    )


@app.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    page: int = 1,
    limit: int = 12,
    unverified: bool = Query(False),
):
    query = db.query(Image)
    if unverified and current_user.role == "master":
        query = query.filter((Image.is_verified == False) | (Image.is_verified.is_(None)))
    total = query.with_entities(func.count(Image.id)).scalar()
    images = query.offset((page - 1) * limit).limit(limit).all()
    total_pages = (total + limit - 1) // limit
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "images": images,
            "search": "",
            "page": page,
            "total_pages": total_pages,
            "unverified": bool(unverified and current_user.role == "master"),
        },
    )


@app.get("/api/stats/tags")
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


@app.get("/api/stats/tags-percent")
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
    percentages = {tag: (count / total_tags * 100) for tag, count in tag_count.items()}
    return {"tags": list(percentages.keys()), "percentages": list(percentages.values())}


@app.get("/api/stats/tag-combos")
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


@app.get("/stats", response_class=HTMLResponse)
async def stats_page(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(Image.id)).scalar()
    return templates.TemplateResponse(
        "stats.html", {"request": request, "total_images": total}
    )


# Страница загрузки
@app.get("/upload", response_class=HTMLResponse)
async def upload_page(
    request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    tag_names = [t.name for t in db.query(Tag).order_by(Tag.name.asc()).all()]
    return templates.TemplateResponse(
        "upload.html", {"request": request, "tags": tag_names}
    )


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


@app.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Проверка тегов по базе: все выбранные должны существовать
    existing_names = {t.name for t in _get_tags_by_names(db, tags)}
    invalid_tags = [tag for tag in tags if tag not in existing_names]
    if invalid_tags:
        raise HTTPException(status_code=400, detail=f"Недопустимые теги: {invalid_tags}")

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
        shutil.copyfileobj(file.file, buffer)

    # Сохранение в базе данных
    image = Image(
        name=name,
        file_path=f"/uploads/{filename}",
        tags=",".join(tags),  # legacy
        author_id=current_user.id,
        # uploaded_at поставится по умолчанию
        is_verified=False,
    )
    db.add(image)
    db.flush()

    # Нормализация тегов в отдельную таблицу
    _sync_image_tags(db, image, tags)

    db.commit()
    db.refresh(image)

    # Перенаправление на страницу edit изображения
    return RedirectResponse(url=f"/image_editor?image_id={image.id}", status_code=303)

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

    tags = re.findall(r"tag:([^\s]+)", query)
    tags = [t.lower() for t in tags]

    cleaned_query = (
        re.sub(
            r"(id\s*[<>=]{1,2}\s*\d+|id:\d+|count\s*[<>=]{1,2}\s*\d+|tag:[^\s]+)",
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
            results = [img for img in results if len(img.tags.split(",")) == val]
        elif op == ">":
            results = [img for img in results if len(img.tags.split(",")) > val]
        elif op == "<":
            results = [img for img in results if len(img.tags.split(",")) < val]
        elif op == ">=":
            results = [img for img in results if len(img.tags.split(",")) >= val]
        elif op == "<=":
            results = [img for img in results if len(img.tags.split(",")) <= val]

    # --- фильтр по тегам ---
    for tag in search_params["tags"]:
        results = [img for img in results if tag in img.tags.lower().split(",")]

    # --- текстовый поиск ---
    text = search_params["text_query"]
    if text:

        def fuzzy_match(img):
            candidates = [img.name.lower()] + img.tags.lower().split(",")
            for c in candidates:
                if text.lower() in c:
                    return True
            return False

        results = [img for img in results if fuzzy_match(img)]

    return results


@app.get("/search", response_class=HTMLResponse)
async def search_images(
    request: Request,
    search: str = "",
    page: int = 1,
    limit: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    unverified: bool = Query(False),
):
    all_images = db.query(Image).all()

    if search:
        search_params = parse_search_query(search)
        print(search_params)
        filtered_images = apply_search_filters(all_images, search_params)
    else:
        filtered_images = all_images

    if unverified and current_user.role == "master":
        filtered_images = [
            img for img in filtered_images if not getattr(img, "is_verified", False)
        ]

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
            "unverified": bool(unverified and current_user.role == "master"),
        },
    )


@app.get("/image/{image_id}", response_class=HTMLResponse)
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
    prev_image = db.query(Image).filter(Image.id < image.id).order_by(Image.id.desc()).first()
    if not prev_image:
        prev_image = Image(id=0)
    next_image = db.query(Image).filter(Image.id > image.id).order_by(Image.id.asc()).first()
    if not next_image:
        next_image = Image(id=0)
    return templates.TemplateResponse(
        "image_detail.html",
        {"request": request, "image": image, "tags": tag_names, "prev_id": prev_image.id, "next_id": next_image.id},
    )


# Удаление изображения
@app.post("/image/{image_id}/delete", response_class=RedirectResponse)
async def delete_image(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    # Удаление файла из папки uploads
    file_path = f"app{image.file_path}"
    if os.path.exists(file_path):
        os.remove(file_path)

    # Удаление записи из базы данных
    db.delete(image)
    db.commit()

    # Перенаправление на главную страницу
    return RedirectResponse(url="/", status_code=303)


@app.post("/image/{image_id}/update", response_class=RedirectResponse)
async def update_image(
    image_id: int,
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    # Проверка тегов по базе
    existing_names = {t.name for t in _get_tags_by_names(db, tags)}
    invalid_tags = [tag for tag in tags if tag not in existing_names]
    if invalid_tags:
        raise HTTPException(status_code=400, detail=f"Недопустимые теги: {invalid_tags}")

    image.name = name
    image.tags = ",".join(tags)

    # Обновляем нормализованные теги
    _sync_image_tags(db, image, tags)

    db.commit()

    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


# Админка управления тегами (только master)
@app.get("/admin/tags", response_class=HTMLResponse)
async def tags_page(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    tags = db.query(Tag).order_by(Tag.name.asc()).all()
    return templates.TemplateResponse("tags.html", {"request": request, "tags": tags})


@app.post("/admin/tags")
async def create_tag(
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название тега не может быть пустым")
    exists = db.query(Tag).filter(func.lower(Tag.name) == name.lower()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Тег уже существует")
    db.add(Tag(name=name))
    db.commit()
    return RedirectResponse(url="/admin/tags", status_code=303)


@app.post("/admin/tags/{tag_id}/delete")
async def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
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
    db.query(ImageTag).filter(ImageTag.tag_id == tag.id).delete(synchronize_session=False)
    db.delete(tag)
    db.commit()
    return RedirectResponse(url="/admin/tags", status_code=303)


# Создание и скачивание бэкапа
@app.get("/backup")
async def create_backup(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Получение всех изображений из базы данных
    images = db.query(Image).all()

    # Создание JSON с метаданными
    metadata = []
    for image in images:
        metadata.append(
            {
                "name": image.name,
                "file_path": image.file_path,
                "tags": image.tags.split(","),
                "author_id": image.author_id,
                "uploaded_at": image.uploaded_at.isoformat() if image.uploaded_at else None,
                "is_verified": bool(image.is_verified),
            }
        )

    # Создание ZIP-архива в памяти
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # Добавление JSON с метаданными
        zip_file.writestr(
            "metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2)
        )

        # Добавление изображений из папки uploads
        uploads_dir = "app/uploads"
        for image in images:
            file_path = f"app{image.file_path}"  # Преобразуем /uploads/filename в app/uploads/filename
            if os.path.exists(file_path):
                # Используем только имя файла для сохранения в архиве
                arcname = os.path.basename(file_path)
                zip_file.write(file_path, arcname)

    buffer.seek(0)

    # Формирование имени файла с текущей датой и временем
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"backup_{timestamp}.zip"

    # Возвращение ZIP-архива как потока
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={backup_filename}"},
    )

# Маркировка изображения как проверенного (только master)
@app.post("/image/{image_id}/verify", response_class=RedirectResponse)
async def verify_image(
    image_id: int,
    status: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")

    # not ver, ready to mark, full ver
    verified_statuses = [0,1,2]
    if status not in verified_statuses:
        raise HTTPException(status_code=404, detail="Неверный тип подтверждения")

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    image.is_verified = status
    db.commit()
    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


# Админские роуты для регистрации пользователей (только master)
@app.get("/admin/users", response_class=HTMLResponse)
async def create_user_page(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return templates.TemplateResponse("register.html", {"request": request})


@app.post("/admin/users")
async def create_user(
    username: str = Form(...),
    password: str = Form(...),
    role: str = Form("slave"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "master":
        raise HTTPException(status_code=403, detail="Недостаточно прав")

    role = role if role in ("master", "slave") else "slave"

    # Проверка уникальности
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")

    try:
        from passlib.hash import bcrypt

        password_hash = bcrypt.hash(password)
    except Exception:
        password_hash = password

    user = User(username=username, password_hash=password_hash, role=role)
    db.add(user)
    db.commit()

    return RedirectResponse(url="/admin/users", status_code=303)
