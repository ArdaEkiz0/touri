#!/usr/bin/python3
"""A fresh private X11 cookie on every boot; the agent never receives it."""
import os
import secrets
import stat
import struct
import sys

def prepare(path, uid=1001, gid=1001):
    directory = os.open(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = '.xauth-' + secrets.token_hex(16)
    fd = None
    try:
        try:
            old = os.stat(os.path.basename(path), dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(old.st_mode) or old.st_nlink != 1: raise ValueError('unsafe authority target')
        except FileNotFoundError: pass
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        def field(value): return struct.pack('!H', len(value)) + value
        # FamilyWild avoids dependence on the transient guest hostname.
        record = struct.pack('!H', 65535) + field(b'') + field(b'99') + field(b'MIT-MAGIC-COOKIE-1') + field(secrets.token_bytes(16))
        view = memoryview(record)
        while view:
            count = os.write(fd, view)
            if count <= 0: raise OSError("short authority write")
            view = view[count:]
        os.fchmod(fd, 0o600)
        os.fchown(fd, uid, gid)
        os.fsync(fd)
        os.rename(temporary, os.path.basename(path), src_dir_fd=directory, dst_dir_fd=directory)
        temporary = None
        os.fsync(directory)
    finally:
        if fd is not None: os.close(fd)
        if temporary is not None and fd is not None:
            try: os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError: pass
        os.close(directory)

if __name__ == '__main__': prepare(sys.argv[1])
