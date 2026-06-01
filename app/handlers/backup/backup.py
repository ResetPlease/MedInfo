from fastapi import (
    Depends,
    APIRouter,
    Query,
)
from fastapi.responses import StreamingResponse

from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Image, User
from app.security import get_current_user
from app.services.image_status import STATUS_DONE

from io import BytesIO
from collections import Counter
from typing import Optional
import json
import zipfile
from datetime import datetime
import os

router = APIRouter()


def _split_tags(raw: Optional[str]):
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


@router.get("/backup")
async def create_backup(
    only_segmented: bool = Query(False, description="только картинки, где есть сегментации"),
    only_verified: bool = Query(False, description="только со статусом DONE (is_verified=3)"),
    status: Optional[int] = Query(None, description="точный is_verified (0..3)"),
    author_id: Optional[int] = Query(None, description="фильтр по автору"),
    tag: Optional[str] = Query(None, description="только картинки с этим тегом"),
    include_images: bool = Query(True, description="класть файлы картинок в архив"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Тянем картинки сразу с сегментациями (без N+1).
    query = db.query(Image).options(selectinload(Image.segmentations))

    if status is not None:
        query = query.filter(Image.is_verified == status)
    elif only_verified:
        query = query.filter(Image.is_verified == STATUS_DONE)
    if author_id is not None:
        query = query.filter(Image.author_id == author_id)

    images = query.order_by(Image.id.asc()).all()

    if tag:
        images = [img for img in images if tag in _split_tags(img.tags)]

    metadata = []
    included = []
    class_counter = Counter()
    status_counter = Counter()
    num_with_seg = 0
    total_segs = 0

    for image in images:
        segmentations = {
            seg.label: (seg.data or [])
            for seg in image.segmentations
            if seg.data
        }
        if only_segmented and not segmentations:
            continue
        included.append(image)

        if segmentations:
            num_with_seg += 1
        for label, polys in segmentations.items():
            class_counter[label] += 1
            total_segs += 1
        status_counter[image.is_verified] += 1

        metadata.append(
            {
                "id": image.id,
                "name": image.name,
                "file_path": image.file_path,
                "file_name": os.path.basename(image.file_path) if image.file_path else None,
                "tags": _split_tags(image.tags),
                "author_id": image.author_id,
                "uploaded_at": image.uploaded_at.isoformat() if image.uploaded_at else None,
                "is_verified": image.is_verified,
                "segmentations": segmentations,
            }
        )

    summary = {
        "generated_at": datetime.now().isoformat(),
        "filters": {
            "only_segmented": only_segmented,
            "only_verified": only_verified,
            "status": status,
            "author_id": author_id,
            "tag": tag,
            "include_images": include_images,
        },
        "num_images": len(metadata),
        "num_with_segmentations": num_with_seg,
        "total_segmentations": total_segs,
        "status_distribution": {str(k): v for k, v in sorted(status_counter.items(), key=lambda x: (x[0] is None, x[0]))},
        "class_distribution": dict(class_counter.most_common()),
        "format": "metadata.json: list of images; segmentations = {label: [[{x,y}...]...]} normalized [0..1]",
        "train_hint": "python -m training.train --metadata metadata.json --img-dir images --res 768 --aug strong",
    }
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
        zip_file.writestr("summary.json", json.dumps(summary, ensure_ascii=False, indent=2))

        if include_images:
            for image in included:
                if not image.file_path:
                    continue
                file_path = f"app{image.file_path}"
                if os.path.exists(file_path):
                    arcname = os.path.join("images", os.path.basename(file_path))
                    zip_file.write(file_path, arcname)

    buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"backup_{timestamp}.zip"

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={backup_filename}"},
    )
