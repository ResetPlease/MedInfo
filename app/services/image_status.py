from typing import Optional

STATUS_TAGS_PENDING = 0
STATUS_READY_FOR_MARKUP = 1
STATUS_MARKUP_REVIEW = 2
STATUS_DONE = 3

KNOWN_IMAGE_STATUSES = {
    STATUS_TAGS_PENDING,
    STATUS_READY_FOR_MARKUP,
    STATUS_MARKUP_REVIEW,
    STATUS_DONE,
}

EDITOR_ALLOWED_STATUSES = {
    STATUS_READY_FOR_MARKUP,
    STATUS_MARKUP_REVIEW,
    STATUS_DONE,
}


def can_open_editor(status: Optional[int]) -> bool:
    if status is None:
        return False

    return status >= STATUS_READY_FOR_MARKUP


def needs_markup_review_after_change(status: Optional[int]) -> bool:
    if status is None:
        return False

    return status >= STATUS_READY_FOR_MARKUP
