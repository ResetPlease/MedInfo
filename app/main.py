from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.handlers import admin, backup, statistics
from app.handlers.api import api

app = FastAPI()

app.mount("/static", StaticFiles(directory="app/static"), name="static")

init_db()

app.include_router(admin.router)
app.include_router(api.router)
app.include_router(backup.router)
app.include_router(statistics.router)
