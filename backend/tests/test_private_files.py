"""Private-file protection is tested on the platform actually executing pytest."""

import os
import subprocess

from app.private_files import protect_private_fd


def test_existing_file_permissions_are_restricted_without_losing_unicode(tmp_path):
    target = tmp_path / "Synthetic private file 空格.txt"
    target.write_text("synthetic-old", encoding="utf-8")
    if os.name != "nt":
        target.chmod(0o666)
    fd = os.open(target, os.O_WRONLY | os.O_TRUNC)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        protect_private_fd(stream.fileno())
        stream.write("合成测试 synthetic-only")
    assert target.read_text(encoding="utf-8") == "合成测试 synthetic-only"
    if os.name == "nt":
        acl = subprocess.check_output(["icacls", str(target)], text=True)
        assert "(I)" not in acl
        assert "Everyone:" not in acl and "BUILTIN\\Users:" not in acl
        assert acl.count("(F)") == 2
    else:
        assert target.stat().st_mode & 0o777 == 0o600
