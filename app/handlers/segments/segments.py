from typing import List, cast

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Segmentation, User
from app.security import get_current_user

router = APIRouter()


# сохраняем сегмент со страницы редактирования фоток по типу морщины
@router.post("/segmentations/{image_id}/{label}")
def save_segmentation(
    image_id: int,
    label: str,
    data: List[List[dict]],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    seg = db.query(Segmentation).filter_by(image_id=image_id, label=label).first()
    if seg:
        seg.data = data
    else:
        seg = Segmentation(image_id=image_id, label=label, data=data)
        db.add(seg)
    db.commit()
    return {"status": "ok"}


# удаляем сегменты по id фотки + тип морщины
@router.delete("/segmentations/{image_id}/{label}")
def delete_segmentation(image_id: int, 
                        label: str, 
                        db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    seg = db.query(Segmentation).filter_by(image_id=image_id, label=label).first()
    if seg:
        db.delete(seg)
        db.commit()
    return {"status": "deleted"}


@router.get("/segmentations/{image_id}")
def get_segmentations(image_id: int, 
                      db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    segs = db.query(Segmentation).filter_by(image_id=image_id).all()
    return {seg.label: seg.data for seg in segs}