from datetime import datetime

from sqlalchemy import (JSON, Boolean, Column, DateTime, ForeignKey, Integer,
                        String, UniqueConstraint)
from sqlalchemy.orm import relationship

from app.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    # 'master' | 'slave' | ADD 'guest'
    role = Column(String, nullable=False, default="slave")

    images = relationship("Image", back_populates="author")


class Segmentation(Base):
    __tablename__ = "segmentations"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    label = Column(String, nullable=False)  # название морщины
    data = Column(JSON, nullable=True)  # полигоны [{points: [[x,y],...]}]

    image = relationship("Image", back_populates="segmentations")


class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    file_path = Column(String)

    # Legacy denormalized tags (kept for backward compatibility)
    tags = Column(String)

    # New fields
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    is_verified = Column(Integer, default=0, nullable=True)

    author = relationship("User", back_populates="images")
    tag_links = relationship(
        "ImageTag", back_populates="image", cascade="all, delete-orphan")
    segmentations = relationship(
        "Segmentation", back_populates="image", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)

    image_links = relationship(
        "ImageTag", back_populates="tag", cascade="all, delete-orphan")


class ImageTag(Base):
    __tablename__ = "image_tags"
    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)

    image = relationship("Image", back_populates="tag_links")
    tag = relationship("Tag", back_populates="image_links")

    __table_args__ = (
        UniqueConstraint("image_id", "tag_id", name="uq_image_tag"),
    )
