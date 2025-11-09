from typing import Annotated, Any, Optional

from fastapi import Depends, HTTPException

from app.models import Role, User, get_role_level

from .security import get_current_user


class MinRoleRequired():
    def __init__(self, min_role: Role) -> None:
        self.min_role = min_role

    def __call__(self, user: Annotated[User, Depends(get_current_user)]) -> Any:
        role: Optional[Role] = None
        try:
            role = Role(user.role)
        except:
            raise HTTPException(
                status_code=403, detail="Недостаточно прав: неверная роль")

        if get_role_level(role) < get_role_level(self.min_role):
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        return user
