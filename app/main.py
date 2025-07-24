from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
import os
import shutil
from typing import List
from datetime import datetime
from .database import SessionLocal, init_db
from .models import Image
from fastapi import Request

app = FastAPI()
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.mount("/uploads", StaticFiles(directory="app/uploads"), name="uploads")
templates = Jinja2Templates(directory="app/templates")

# Предопределенные теги
ALLOWED_TAGS = [
    "Лобные морщины",
    "Межбровные морщины",
    "Гусиные лапки",
    "Носогубные складки",
    "Морщины вокруг рта"
]

# Создание базы данных при старте
init_db()

# Зависимость для получения сессии базы данных
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Главная страница с просмотром изображений
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, db: Session = Depends(get_db)):
    images = db.query(Image).all()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "images": images,
        "search": ""
    })

# Страница загрузки
@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request):
    return templates.TemplateResponse("upload.html", {
        "request": request,
        "tags": ALLOWED_TAGS
    })

# Загрузка изображения и тегов
@app.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: List[str] = Form(...),
    db: Session = Depends(get_db)
):
    # Проверка тегов
    invalid_tags = [tag for tag in tags if tag not in ALLOWED_TAGS]
    if invalid_tags:
        raise HTTPException(status_code=400, detail=f"Недопустимые теги: {invalid_tags}")

    # Сохранение файла
    file_extension = file.filename.split(".")[-1]
    if file_extension.lower() not in ["jpg", "jpeg", "png"]:
        raise HTTPException(status_code=400, detail="Допустимы только файлы .jpg, .jpeg, .png")
    
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

# Поиск изображений по названию
@app.get("/search", response_class=HTMLResponse)
async def search_images(request: Request, search: str = "", db: Session = Depends(get_db)):
    query = db.query(Image)
    if search:
        query = query.filter(Image.name.ilike(f"%{search}%")).limit(50)
    images = query.all()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "images": images,
        "search": search
    })

# Страница деталей изображения
@app.get("/image/{image_id}", response_class=HTMLResponse)
async def image_detail(request: Request, image_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    return templates.TemplateResponse("image_detail.html", {
        "request": request,
        "image": image
    })