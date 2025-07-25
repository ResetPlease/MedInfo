from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Depends, Request, Security
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
import os
import shutil
import json
import zipfile
from io import BytesIO
from typing import List
from datetime import datetime
from .database import SessionLocal, init_db
from .models import Image

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

# Захардкоженные учетные данные
security = HTTPBasic()

def verify_credentials(credentials: HTTPBasicCredentials = Security(security)):
    correct_username = "admin"
    correct_password = "imagebank4009"
    if credentials.username != correct_username or credentials.password != correct_password:
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

# Главная страница с просмотром изображений
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, db: Session = Depends(get_db), credentials: HTTPBasicCredentials = Depends(verify_credentials)):
    images = db.query(Image).all()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "images": images,
        "search": ""
    })

# Страница загрузки
@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request, credentials: HTTPBasicCredentials = Depends(verify_credentials)):
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
    db: Session = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(verify_credentials)
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
async def search_images(request: Request, search: str = "", db: Session = Depends(get_db), credentials: HTTPBasicCredentials = Depends(verify_credentials)):
    query = db.query(Image)
    if search:
        query = query.filter(Image.name.ilike(f"%{search}%"))
    images = query.all()
    return templates.TemplateResponse("index.html", {
        "request": request,
        "images": images,
        "search": search
    })

# Страница деталей изображения
@app.get("/image/{image_id}", response_class=HTMLResponse)
async def image_detail(request: Request, image_id: int, db: Session = Depends(get_db), credentials: HTTPBasicCredentials = Depends(verify_credentials)):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    return templates.TemplateResponse("image_detail.html", {
        "request": request,
        "image": image
    })

# Удаление изображения
@app.post("/image/{image_id}/delete", response_class=RedirectResponse)
async def delete_image(image_id: int, db: Session = Depends(get_db), credentials: HTTPBasicCredentials = Depends(verify_credentials)):
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

# Создание и скачивание бэкапа
@app.get("/backup")
async def create_backup(db: Session = Depends(get_db), credentials: HTTPBasicCredentials = Depends(verify_credentials)):
    # Получение всех изображений из базы данных
    images = db.query(Image).all()
    
    # Создание JSON с метаданными
    metadata = [
        {
            "name": image.name,
            "file_path": image.file_path,
            "tags": image.tags.split(",")
        } for image in images
    ]
    
    # Создание ZIP-архива в памяти
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # Добавление JSON с метаданными
        zip_file.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
        
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
        headers={"Content-Disposition": f"attachment; filename={backup_filename}"}
    )