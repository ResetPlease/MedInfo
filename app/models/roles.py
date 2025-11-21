from enum import Enum
from typing import List, cast

from .models import User


class Role(Enum):
    ADMIN = "owner"  # 3
    WORKER = "worker"  # 2
    GUEST = "guest"  # 1

ROLE_LEVEL_ADMIN = 3
ROLE_LEVEL_WORKER = 2
ROLE_LEVEL_GUEST = 1

ROLE_LEVELS = {
    Role.ADMIN: ROLE_LEVEL_ADMIN,
    Role.WORKER: ROLE_LEVEL_WORKER,
    Role.GUEST: ROLE_LEVEL_GUEST,
}

_LEGACY_ALIASES = {
    "master": Role.ADMIN,
    "slave": Role.WORKER,
}


def normalize_role(role_value: str) -> Role:
    """
    Accepts both new names (owner/worker/guest) and legacy ones (master/slave).
    """
    try:
        return Role(role_value)
    except ValueError:
        if role_value in _LEGACY_ALIASES:
            return _LEGACY_ALIASES[role_value]
        raise


def get_role_level(role: Role) -> int:
    return ROLE_LEVELS[role]


def at_least_worker(user: User) -> bool:
    role = normalize_role(user.role)
    return ROLE_LEVELS[role] >= ROLE_LEVEL_WORKER


editors = [Role.ADMIN.value, Role.WORKER.value]


def isAdmin(role: str):
    return normalize_role(role) == Role.ADMIN


def isEditor(role: str):
    return normalize_role(role) in (Role.ADMIN, Role.WORKER)


def isGuest(role: str):
    return normalize_role(role) == Role.GUEST


def allRoles() -> List[str]:
    return [role.value for role in Role]


def isModelAdmin(user: User):
    role = cast(str, user.role)
    return isAdmin(role)


def isModelEditor(user: User):
    role = cast(str, user.role)
    return isEditor(role)
