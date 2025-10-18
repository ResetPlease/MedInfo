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
    try:
        cols = _get_existing_columns("images")

        alter_statements = []

        if "author_id" not in cols:
            alter_statements.append("ALTER TABLE images ADD COLUMN author_id INTEGER")
        if "uploaded_at" not in cols:
            alter_statements.append("ALTER TABLE images ADD COLUMN uploaded_at DATETIME")

        # обработка is_verified
        with engine.begin() as conn:
            if "is_verified" not in cols:
                # если поля нет — просто добавляем как INTEGER
                conn.exec_driver_sql("ALTER TABLE images ADD COLUMN is_verified INTEGER DEFAULT 0")
            else:
                # проверяем тип колонки
                result = conn.exec_driver_sql("PRAGMA table_info(images)")
                col_types = {row[1]: row[2].upper() for row in result.fetchall()}
                if col_types.get("is_verified") in ("BOOLEAN", "BOOL"):
                    # создаем новую временную таблицу с нужным типом
                    conn.exec_driver_sql("""
                        ALTER TABLE images RENAME TO images_old;
                    """)
                    conn.exec_driver_sql("""
                        CREATE TABLE images (
                            id INTEGER PRIMARY KEY,
                            name TEXT,
                            file_path TEXT,
                            tags TEXT,
                            author_id INTEGER,
                            uploaded_at DATETIME,
                            is_verified INTEGER DEFAULT 0
                        );
                    """)
                    # переносим данные
                    conn.exec_driver_sql("""
                        INSERT INTO images (id, name, file_path, tags, author_id, uploaded_at, is_verified)
                        SELECT id, name, file_path, tags, author_id, uploaded_at,
                               CASE WHEN is_verified THEN 1 ELSE 0 END
                        FROM images_old;
                    """)
                    conn.exec_driver_sql("DROP TABLE images_old;")

        # Бэкфилл и нормализация, как раньше
        from sqlalchemy.orm import Session
        from .models import Image, Tag, ImageTag, User

        with Session(bind=engine) as session:
            images = session.query(Image).all()

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

            name_to_tag = {t.name: t for t in session.query(Tag).all()}
            for img in images:
                if not img.tags:
                    continue
                wanted = {name_to_tag[t.strip()].id for t in img.tags.split(",") if t.strip() in name_to_tag}
                current = {link.tag_id for link in img.tag_links} if hasattr(img, "tag_links") else set()
                for tag_id in wanted - current:
                    session.add(ImageTag(image_id=img.id, tag_id=tag_id))

            admin = session.query(User).filter(User.username == "admin").first()
            if admin:
                session.query(Image).filter(Image.author_id.is_(None)).update({Image.author_id: admin.id})
            session.commit()

    except Exception as e:
        print("Migration failed:", e)


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
