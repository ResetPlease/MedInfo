from enum import Enum
from typing import List, cast

from .models import User


class Role(Enum):
    ADMIN = "master" # 3
    WORKER = "slave" # 2
    GUEST = "guest" # 1

ROLE_LEVEL_ADMIN = 3
ROLE_LEVEL_WORKER = 2
ROLE_LEVEL_GUEST = 1


ROLE_LEVELS = {
    Role.ADMIN : ROLE_LEVEL_ADMIN,
    Role.WORKER: ROLE_LEVEL_WORKER,
    Role.GUEST: ROLE_LEVEL_GUEST
}

def get_role_level(role: Role) -> int:
        return ROLE_LEVELS[role]
    
def at_least_worker(user: User) -> bool:
    role = Role(user.role)
    return ROLE_LEVELS[role] >= ROLE_LEVEL_WORKER

    
    
editors = [Role.ADMIN.value, Role.WORKER.value]


def isAdmin(role: str):
    return role == Role.ADMIN.value


def isEditor(role: str):
    return role in editors


def isGuest(role: str):
    return role == Role.GUEST.value


def allRoles() -> List[str]:
    return [role.value for role in Role]


def isModelAdmin(user: User):
    role = cast(str, user.role)
    return isAdmin(role)

def isModelEditor(user: User):
    role = cast(str, user.role)
    return isEditor(role)