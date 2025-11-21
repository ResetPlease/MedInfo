import os
from typing import cast, Optional
from shutil import copyfileobj

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.exceptions import HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.inference import predict_wrinkles
from app.models import Image, Tag, User, isModelAdmin, Role, at_least_worker
from app.security import get_current_user, MinRoleRequired

UPLOAD_DIR = "app/uploads/predict"

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

@router.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    page: int = 1,
    limit: int = 12,
    unverified: bool = Query(False),
    status: Optional[int] = Query(None),
    mine: bool = Query(False),
):
    query = db.query(Image)

    if mine:
        query = query.filter(Image.assigned_user_id == current_user.id)
    if status is not None:
        query = query.filter(Image.is_verified == status)
    elif unverified and isModelAdmin(current_user):
        query = query.filter((Image.is_verified == False) | (Image.is_verified.is_(None)))

    found_total = query.with_entities(func.count(Image.id)).scalar()
    total = found_total
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
            "isModelAdmin": isModelAdmin,
            "at_least_worker": at_least_worker,
            "unverified": bool(unverified and isModelAdmin(current_user)),
            "status": status,
            "found_total": found_total,
            "mine": mine,
        },
    )


# Страница загрузки
@router.get("/upload", response_class=HTMLResponse)
async def upload_page(
    request: Request, current_user: User = Depends(MinRoleRequired(Role.WORKER)), db: Session = Depends(get_db)
):
    tag_names = [t.name for t in db.query(Tag).order_by(Tag.name.asc()).all()]
    return templates.TemplateResponse(
        "upload.html", {"request": request, "tags": tag_names, "isModelAdmin" : isModelAdmin}
    )


@router.post("/predict")
async def predict(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if not os.path.exists(UPLOAD_DIR):
        os.mkdir(UPLOAD_DIR)
    file_path = os.path.join(UPLOAD_DIR, cast(str,file.filename))
    with open(file_path, "wb") as f:
        copyfileobj(file.file, f)

    labels = predict_wrinkles(file_path)
    return {"wrinkles": labels}


@router.get("/predict")
async def predict_template(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        "predict.html",
        {"request": request,
         "at_least_worker": at_least_worker},
    )
