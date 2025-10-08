from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from typing import Set

# Создание папки db, если не существует
if not os.path.exists("app/db"):
    os.makedirs("app/db")

# Путь к базе данных
DATABASE_URL = "sqlite:///app/db/images.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db():
    from . import models
    # Создание папки uploads, если не существует
    if not os.path.exists("app/uploads"):
        os.makedirs("app/uploads")
    # Создание таблиц (idempotent)
    Base.metadata.create_all(bind=engine)

    # Легкая миграция для добавления недостающих колонок в images
    _migrate_schema_sqlite()

    # Создание дефолтного пользователя master, если пользователей нет
    _ensure_default_master_user()


def _get_existing_columns(table_name: str) -> Set[str]:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(f"PRAGMA table_info({table_name})")
        cols = {row[1] for row in result.fetchall()}  # name is at index 1
    return cols


def _migrate_schema_sqlite():
    # Добавление новых колонок в images при необходимости
    try:
        cols = _get_existing_columns("images")
        alter_statements = []
        if "author_id" not in cols:
            alter_statements.append("ALTER TABLE images ADD COLUMN author_id INTEGER")
        if "uploaded_at" not in cols:
            alter_statements.append("ALTER TABLE images ADD COLUMN uploaded_at DATETIME")
        if "is_verified" not in cols:
            alter_statements.append("ALTER TABLE images ADD COLUMN is_verified BOOLEAN DEFAULT 0")

        if alter_statements:
            with engine.begin() as conn:
                for stmt in alter_statements:
                    conn.exec_driver_sql(stmt)

        # Бэкфилл нормализованных тегов для существующих записей
        from sqlalchemy.orm import Session
        from .models import Image, Tag, ImageTag, User

        with Session(bind=engine) as session:
            images = session.query(Image).all()
            # Собираем набор всех тегов
            unique_tags = set()
            for img in images:
                if img.tags:
                    for t in img.tags.split(","):
                        t = t.strip()
                        if t:
                            unique_tags.add(t)

            if unique_tags:
                existing = session.query(Tag).filter(Tag.name.in_(list(unique_tags))).all()
                existing_names = {t.name for t in existing}
                for name in unique_tags:
                    if name not in existing_names:
                        session.add(Tag(name=name))
                session.flush()

            # Обеспечиваем связи image_tags
            name_to_tag = {t.name: t for t in session.query(Tag).all()}
            for img in images:
                if not img.tags:
                    continue
                wanted = {name_to_tag[t.strip()].id for t in img.tags.split(",") if t.strip() in name_to_tag}
                current = {link.tag_id for link in img.tag_links} if hasattr(img, "tag_links") else set()
                for tag_id in wanted - current:
                    session.add(ImageTag(image_id=img.id, tag_id=tag_id))

            # Бэкфилл автора: все старые фото без автора -> admin
            admin = session.query(User).filter(User.username == "admin").first()
            if admin:
                session.query(Image).filter(Image.author_id.is_(None)).update({Image.author_id: admin.id})
            session.commit()
    except Exception:
        # Не блокируем запуск приложения из-за миграций
        pass


def _ensure_default_master_user():
    # Ленивая импорт во избежание циклических зависимостей
    from .models import User
    from sqlalchemy.orm import Session

    admin_pass = "imsexy2004"

    with Session(bind=engine) as session:
        has_users = session.query(User).first() is not None
        if not has_users:
            # username: admin, password: imagebank2049 (как раньше), роль master
            try:
                from passlib.hash import bcrypt

                password_hash = bcrypt.hash(admin_pass)
            except Exception:
                # В крайнем случае сохраняем как есть (не рекомендуется), но для обратной совместимости
                password_hash = admin_pass

            user = User(username="admin", password_hash=password_hash, role="master")
            session.add(user)
            session.commit()
