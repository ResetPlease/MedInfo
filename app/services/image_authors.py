from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Image, ImageAuthor, User


def register_image_author(
    db: Session,
    image: Image,
    user: User,
) -> None:
    existing = (
        db.query(ImageAuthor)
        .filter(ImageAuthor.image_id == image.id, ImageAuthor.user_id == user.id)
        .first()
    )
    if existing:
        return

    db.add(
        ImageAuthor(
            image_id=image.id,
            user_id=user.id,
            created_at=datetime.utcnow(),
        )
    )
