from fastapi import (
    Depends,
    APIRouter,
)
from fastapi.responses import StreamingResponse

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Image, User
from app.security import get_current_user

from io import BytesIO
import json
import zipfile
from datetime import datetime
import os

router = APIRouter()

# TODO обновить backup с добавлением сегментов

# Создание и скачивание бэкапа
@router.get("/backup")
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
            # Преобразуем /uploads/filename в app/uploads/filename
            file_path = f"app{image.file_path}"
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
