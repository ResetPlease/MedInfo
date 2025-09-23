from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .database import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="slave")  # 'master' | 'slave'

    images = relationship("Image", back_populates="author")


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
    is_verified = Column(Boolean, default=False, nullable=True)

    author = relationship("User", back_populates="images")
    tag_links = relationship("ImageTag", back_populates="image", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)

    image_links = relationship("ImageTag", back_populates="tag", cascade="all, delete-orphan")


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
