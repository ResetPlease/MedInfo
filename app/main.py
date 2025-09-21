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
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, Response, FileResponse
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
from .models import Image
import re
from collections import Counter
from itertools import combinations
import io
from PIL import Image as Img
import sys
import os
from .inference import predict_wrinkles


app = FastAPI()
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.mount("/uploads", StaticFiles(directory="app/uploads"), name="uploads")
templates = Jinja2Templates(directory="app/templates")

# Предопределенные теги
ALLOWED_TAGS = [
    "Лобные морщины",
    "Гусиные лапки",
    "Носослезная борозда",
    "Веко-скуловая борозда",
    "Малярный мешок",
    "Щечно-скуловая борозда",
    "Кисетные морщины губ",
    "Носогубные складки",
    "Складка марионетки",
    "Межбровные морщины",
    # "Кроличьи морщины",
    # "Морщины подбородка",
]

# Захардкоженные учетные данные
security = HTTPBasic()


def verify_credentials(credentials: HTTPBasicCredentials = Security(security)):
    correct_username = "admin"
    correct_password = "imagebank2049"
    if (
        credentials.username != correct_username
        or credentials.password != correct_password
    ):
        raise HTTPException(
            status_code=401,
            detail="Неверный логин или пароль",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials


# Создание базы данных при старте
init_db()


# Зависимость для получения сессии базы данных
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

UPLOAD_DIR = "app/uploads/predict"

@app.post("/predict")
async def predict(file: UploadFile = File(...),
                  credentials: HTTPBasicCredentials = Depends(verify_credentials),):
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
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    return templates.TemplateResponse(
        "predict.html",
        {"request" : request},
    )




@app.get("/compress/uploads/{path}", response_class=StreamingResponse)
async def get_compressed_photo(
    request: Request,
    path: str,
    credentials: HTTPBasicCredentials = Depends(verify_credentials)
):
    base_dir = Path("app/uploads").resolve()
    file_path = (base_dir / path).resolve()

    if not file_path.is_file() or base_dir not in file_path.parents:
        return Response(content="image not found", status_code=404)

    ext = file_path.suffix.lower().lstrip(".")
    if ext not in ["jpeg", "jpg", "png"]:
        return Response(content="bad path or file ext", status_code=400)

    with Img.open(file_path) as img:
        max_size = (1280, 1280)
        img.thumbnail(max_size)

        img_byte_arr = io.BytesIO()
        if ext in ["jpg", "jpeg"]:
            img.save(img_byte_arr, format="JPEG", quality=20, optimize=True)
        else:
            img.save(img_byte_arr, format="PNG", optimize=True)

        img_byte_arr.seek(0)

    mime = "image/jpeg" if ext in ["jpg", "jpeg"] else f"image/{ext}"
    return StreamingResponse(img_byte_arr, media_type=mime)

@app.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
    page: int = 1,
    limit: int = 12,
):
    total = db.query(func.count(Image.id)).scalar()
    images = db.query(Image).offset((page - 1) * limit).limit(limit).all()
    total_pages = (total + limit - 1) // limit
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "images": images,
            "search": "",
            "page": page,
            "total_pages": total_pages,
        },
    )


@app.get("/api/stats/tags")
async def stats_tags(
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
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
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
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
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
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
    request: Request, credentials: HTTPBasicCredentials = Depends(verify_credentials),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(Image.id)).scalar()
    return templates.TemplateResponse("stats.html", {"request": request, "total_images" : total})


# Страница загрузки
@app.get("/upload", response_class=HTMLResponse)
async def upload_page(
    request: Request, credentials: HTTPBasicCredentials = Depends(verify_credentials)
):
    return templates.TemplateResponse(
        "upload.html", {"request": request, "tags": ALLOWED_TAGS}
    )


# Загрузка изображения и тегов
@app.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    # Проверка тегов
    invalid_tags = [tag for tag in tags if tag not in ALLOWED_TAGS]
    if invalid_tags:
        raise HTTPException(
            status_code=400, detail=f"Недопустимые теги: {invalid_tags}"
        )

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
    image = Image(name=name, file_path=f"/uploads/{filename}", tags=",".join(tags))
    db.add(image)
    db.commit()
    db.refresh(image)

    # Перенаправление на страницу деталей изображения
    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


def parse_search_query(query: str):
    query = query.strip()

    id_filters = []
    id_matches = re.findall(r"id\s*([<>=]{1,2})\s*(\d+)", query)
    for op, val in id_matches:
        id_filters.append((op, int(val)))

    id_colon = re.findall(r"id:(\d+)", query)
    for val in id_colon:
        id_filters.append(("=", int(val)))

    tags = re.findall(r"tag:([^\s]+)", query)
    tags = [t.lower() for t in tags]

    cleaned_query = (
        re.sub(r"(id\s*[<>=]{1,2}\s*\d+|id:\d+|tag:[^\s]+)", "", query).strip().lower()
    )

    return {"id_filters": id_filters, "tags": tags, "text_query": cleaned_query}


def apply_search_filters(images: List, search_params: dict):
    results = images

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

    for tag in search_params["tags"]:
        results = [img for img in results if tag in img.tags.lower().split(",")]

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
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    all_images = db.query(Image).all()

    if search:
        search_params = parse_search_query(search)
        print(search_params)
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
        },
    )


@app.get("/image/{image_id}", response_class=HTMLResponse)
async def image_detail(
    request: Request,
    image_id: int,
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    return templates.TemplateResponse(
        "image_detail.html",
        {"request": request, "image": image, "tags": ALLOWED_TAGS},
    )


# Удаление изображения
@app.post("/image/{image_id}/delete", response_class=RedirectResponse)
async def delete_image(
    image_id: int,
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
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
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    # Проверка тегов
    invalid_tags = [tag for tag in tags if tag not in ALLOWED_TAGS]
    if invalid_tags:
        raise HTTPException(
            status_code=400, detail=f"Недопустимые теги: {invalid_tags}"
        )

    image.name = name
    image.tags = ",".join(tags)
    db.commit()

    return RedirectResponse(url=f"/image/{image.id}", status_code=303)


# Создание и скачивание бэкапа
@app.get("/backup")
async def create_backup(
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials),
):
    # Получение всех изображений из базы данных
    images = db.query(Image).all()

    # Создание JSON с метаданными
    metadata = [
        {
            "name": image.name,
            "file_path": image.file_path,
            "tags": image.tags.split(","),
        }
        for image in images
    ]

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
