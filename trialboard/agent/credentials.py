"""Explicit opt-in private key file loading; never return file contents in errors."""

import os
import stat
from pathlib import Path

from pydantic import SecretStr


def read_private_key(path: Path) -> SecretStr:
    # This permission check is POSIX-specific. Do not claim equivalent Windows ACL checks.
    if os.name != "posix":
        raise ValueError("KEY_FILE_REQUIRES_POSIX_PERMISSIONS")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) & 0o077
                or info.st_nlink != 1
                or not 1 <= info.st_size <= 4096
            ):
                raise ValueError("INVALID_PRIVATE_KEY_FILE")
            raw = os.read(fd, 4097)
        finally:
            os.close(fd)
        value = raw.decode("ascii").strip()
        if len(raw) > 4096 or not value or any(ord(c) < 33 or ord(c) > 126 for c in value):
            raise ValueError("INVALID_PRIVATE_KEY_FILE")
        return SecretStr(value)
    except (OSError, ValueError):
        raise ValueError("INVALID_PRIVATE_KEY_FILE") from None
