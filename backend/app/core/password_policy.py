import re


def validate_password_strength(password: str) -> str | None:
    """Return None if the password is acceptable, else a human-readable reason.

    Policy (kept mobile-friendly): at least 8 chars, at least one letter and
    one digit, and not made entirely of a single repeated character.
    """
    pw = password or ""
    if len(pw) < 8 or len(pw) > 128:
        return "Password must be between 8 and 128 characters"
    if not re.search(r"[A-Za-z]", pw):
        return "Password must contain at least one letter"
    if not re.search(r"\d", pw):
        return "Password must contain at least one number"
    # "aaaaaaa1 ..." style padding is still trivially guessable.
    unique = {c for c in pw}
    if len(letter_chars := [c for c in pw if c.isalpha()]) >= 6 and len(unique) <= 2:
        return "Password is too predictable"
    return None