from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Создание папки db, если не существует
if not os.path.exists("app/db"):
    os.makedirs("app/db")

# Путь к базе данных
DATABASE_URL = "sqlite:///app/db/images.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db():
    # Создание папки uploads, если не существует
    if not os.path.exists("app/uploads"):
        os.makedirs("app/uploads")
    Base.metadata.create_all(bind=engine)
