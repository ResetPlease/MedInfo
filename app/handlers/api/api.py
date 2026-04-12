import os
from shutil import copyfileobj
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.inference import predict_wrinkles
from app.models import Image, Role, Segmentation, User, at_least_worker, isModelAdmin
from app.security import authenticate_user, create_access_token, get_current_user_api
from app.services import (
    ImageListParams,
    KNOWN_IMAGE_STATUSES,
    STATUS_MARKUP_REVIEW,
    create_image,
    can_open_editor,
    get_image_listing,
    get_tag_names,
    needs_markup_review_after_change,
    register_image_author,
    sync_image_tags,
    serialize_current_user,
    serialize_image_card,
)

router = APIRouter(prefix="/api")


class UpdateImagePayload(BaseModel):
    name: str
    tags: list[str]


class AssignImagePayload(BaseModel):
    assigned_user_id: Optional[int] = None


class VerifyImagePayload(BaseModel):
    status: int


class SegmentationPointPayload(BaseModel):
    x: float
    y: float


class SegmentationLinesPayload(BaseModel):
    lines: list[list[SegmentationPointPayload]]


class LoginPayload(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
async def api_login(
    payload: LoginPayload,
    db: Session = Depends(get_db),
):
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        return JSONResponse(
            status_code=401,
            content={"detail": "Неверный логин или пароль"},
        )

    access_token = create_access_token({"sub": user.username})
    response = JSONResponse(
        {
            "status": "ok",
            "user": serialize_current_user(user),
        }
    )
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=60 * 60 * 8,
        samesite="lax",
    )
    return response


@router.get("/auth/me")
async def get_auth_me(
    current_user: User = Depends(get_current_user_api),
):
    return {"user": serialize_current_user(current_user)}


@router.post("/auth/logout")
async def api_logout():
    response = JSONResponse({"status": "ok"})
    response.delete_cookie("access_token")
    return response


@router.get("/images")
async def list_images(
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=100),
    search: str = Query(""),
    unverified: bool = Query(False),
    status: Optional[int] = Query(None),
    mine: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    result = get_image_listing(
        db=db,
        current_user=current_user,
        params=ImageListParams(
            page=page,
            limit=limit,
            search=search,
            unverified=unverified,
            status=status,
            mine=mine,
        ),
    )

    return {
        "items": [serialize_image_card(image, current_user) for image in result["images"]],
        "page": result["page"],
        "limit": result["limit"],
        "total": result["total"],
        "total_pages": result["total_pages"],
        "filters": {
            "search": result["search"],
            "status": result["status"],
            "mine": result["mine"],
            "unverified": result["unverified"],
        },
        "current_user": serialize_current_user(current_user),
    }


@router.get("/tags")
async def list_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    return {"items": get_tag_names(db)}


@router.get("/images/{image_id}")
async def get_image_detail(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    prev_image = db.query(Image).filter(Image.id < image.id).order_by(Image.id.desc()).first()
    next_image = db.query(Image).filter(Image.id > image.id).order_by(Image.id.asc()).first()
    assignee_options = []
    if isModelAdmin(current_user):
        assignee_options = db.query(User).order_by(User.username.asc()).all()

    return {
        "image": serialize_image_card(image, current_user),
        "all_tags": get_tag_names(db),
        "prev_id": prev_image.id if prev_image else None,
        "next_id": next_image.id if next_image else None,
        "assignee_options": [
            {
                "id": user.id,
                "username": user.username,
                "role": user.role,
            }
            for user in assignee_options
        ],
        "current_user": serialize_current_user(current_user),
    }


@router.get("/images/{image_id}/segmentations")
async def get_image_segmentations_api(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    segmentations = db.query(Segmentation).filter(Segmentation.image_id == image.id).all()
    return {
        segmentation.label: segmentation.data or []
        for segmentation in segmentations
    }


@router.get("/images/{image_id}/editor")
async def get_image_editor_data(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not at_least_worker(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    if not can_open_editor(image.is_verified):
        return JSONResponse(
            status_code=409,
            content={"detail": "Разметка доступна только после первичной проверки тегов"},
        )

    prev_image = db.query(Image).filter(Image.id < image.id).order_by(Image.id.desc()).first()
    next_image = db.query(Image).filter(Image.id > image.id).order_by(Image.id.asc()).first()
    segmentations = db.query(Segmentation).filter(Segmentation.image_id == image.id).all()

    return {
        "image": serialize_image_card(image, current_user),
        "editor_tags": _split_legacy_tags(image.tags),
        "segmentations": {
            segmentation.label: segmentation.data or []
            for segmentation in segmentations
        },
        "prev_id": prev_image.id if prev_image else None,
        "next_id": next_image.id if next_image else None,
        "current_user": serialize_current_user(current_user),
    }


@router.post("/images")
async def upload_image_api(
    file: UploadFile = File(...),
    name: str = Form(...),
    tags: list[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if current_user.role not in (Role.ADMIN.value, Role.WORKER.value):
        return JSONResponse(
            status_code=403,
            content={"detail": "Недостаточно прав"},
        )

    image = create_image(
        db=db,
        current_user=current_user,
        file=file,
        name=name,
        tags=tags,
    )

    return {
        "image": serialize_image_card(image, current_user),
        "redirect_url": f"/image/{image.id}",
    }


@router.patch("/images/{image_id}")
async def update_image_api(
    image_id: int,
    payload: UpdateImagePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not at_least_worker(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    image.name = payload.name
    image.tags = ",".join(payload.tags)
    register_image_author(db, image, current_user)
    sync_image_tags(db, image, payload.tags)
    db.commit()
    db.refresh(image)

    return {"image": serialize_image_card(image, current_user)}


@router.put("/images/{image_id}/segmentations/{label}")
async def upsert_segmentation_api(
    image_id: int,
    label: str,
    payload: SegmentationLinesPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not at_least_worker(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    segmentation = (
        db.query(Segmentation)
        .filter(Segmentation.image_id == image_id, Segmentation.label == label)
        .first()
    )

    lines = [
        [{"x": point.x, "y": point.y} for point in line]
        for line in payload.lines
    ]

    if segmentation:
        segmentation.data = lines
    else:
        segmentation = Segmentation(image_id=image_id, label=label, data=lines)
        db.add(segmentation)

    register_image_author(db, image, current_user)
    if needs_markup_review_after_change(image.is_verified):
        image.is_verified = STATUS_MARKUP_REVIEW

    db.commit()

    return {"status": "ok", "label": label, "lines": lines}


@router.delete("/images/{image_id}/segmentations/{label}")
async def delete_segmentation_api(
    image_id: int,
    label: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not at_least_worker(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    segmentation = (
        db.query(Segmentation)
        .filter(Segmentation.image_id == image_id, Segmentation.label == label)
        .first()
    )
    if segmentation:
        db.delete(segmentation)

    register_image_author(db, image, current_user)
    if needs_markup_review_after_change(image.is_verified):
        image.is_verified = STATUS_MARKUP_REVIEW

    db.commit()

    return {"status": "deleted", "label": label}


@router.delete("/images/{image_id}")
async def delete_image_api(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not isModelAdmin(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    file_path = f"app{image.file_path}"
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete(image)
    db.commit()

    return {"status": "ok", "redirect_url": "/"}


@router.put("/images/{image_id}/assignee")
async def assign_image_api(
    image_id: int,
    payload: AssignImagePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not isModelAdmin(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    assignee = None
    if payload.assigned_user_id:
        assignee = db.query(User).filter(User.id == payload.assigned_user_id).first()
        if not assignee:
            return JSONResponse(status_code=404, content={"detail": "Пользователь не найден"})

    image.assigned_user_id = assignee.id if assignee else None
    db.commit()
    db.refresh(image)

    return {"image": serialize_image_card(image, current_user)}


@router.post("/images/{image_id}/verify")
async def verify_image_api(
    image_id: int,
    payload: VerifyImagePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_api),
):
    if not isModelAdmin(current_user):
        return JSONResponse(status_code=403, content={"detail": "Недостаточно прав"})

    if payload.status not in KNOWN_IMAGE_STATUSES:
        return JSONResponse(status_code=400, content={"detail": "Неверный тип подтверждения"})

    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        return JSONResponse(status_code=404, content={"detail": "Изображение не найдено"})

    image.is_verified = payload.status
    db.commit()
    db.refresh(image)

    return {"image": serialize_image_card(image, current_user)}


@router.post("/predict")
async def predict_tags_api(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_api),
):
    upload_dir = "app/uploads/predict"
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)

    file_path = os.path.join(upload_dir, file.filename or "predict-image")
    with open(file_path, "wb") as temp_file:
        copyfileobj(file.file, temp_file)

    labels = predict_wrinkles(file_path)
    return {"wrinkles": labels}


def _split_legacy_tags(tags: Optional[str]) -> list[str]:
    if not tags:
        return []

    return [tag.strip() for tag in tags.split(",") if tag.strip()]
