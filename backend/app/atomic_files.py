"""Publish one complete file with a unique same-directory temporary file."""
import os
import threading
import uuid
from pathlib import Path

from .private_files import protect_private_fd

# Windows can deny a replacement while another thread is replacing the same
# destination. Keep the final publish step sequential within this process;
# temporary files remain unique and are still written independently.
_publish_lock = threading.Lock()


def atomic_write_text(destination: Path, text: str, *, private: bool = False) -> Path:
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    created = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            if private:
                protect_private_fd(output.fileno())
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        with _publish_lock:
            temporary.replace(destination)
    finally:
        if created:
            temporary.unlink(missing_ok=True)
    return destination
