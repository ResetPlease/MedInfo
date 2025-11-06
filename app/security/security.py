from datetime import datetime, timedelta
from typing import Optional, cast

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from passlib.hash import bcrypt
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

# Лучше вынести в env / настройки
SECRET_KEY = "super_public_secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expire = datetime.utcnow() + expires_delta
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, password_hash: str) -> bool:
    # Твоя логика с backward-compat
    try:
        if cast(str, password_hash) and bcrypt.identify(cast(str, password_hash)):
            return bcrypt.verify(plain_password, cast(str, password_hash))
        return plain_password == password_hash
    except Exception:
        return plain_password == password_hash


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(password, cast(str, user.password_hash)):
        return None
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=303, headers={"Location": "/login"})

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=303, headers={"Location": "/login"})
    except JWTError:
        raise HTTPException(status_code=303, headers={"Location": "/login"})

    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=303, headers={"Location": "/login"})

    request.state.current_user = user
    return user

