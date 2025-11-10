from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.handlers import (admin, auth, backup, images, main, search, segments,
                          statistics)

app = FastAPI()

app.mount("/static", StaticFiles(directory="app/static"), name="static")

init_db()

app.include_router(admin.router)
app.include_router(backup.router)
app.include_router(images.router)
app.include_router(main.router)
app.include_router(search.router)
app.include_router(segments.router)
app.include_router(statistics.router)
app.include_router(auth.router)
