"""Run Ripple's local API only while its desktop shell is alive."""

import argparse
import os
import threading
import time

import uvicorn


def stop_when_parent_exits(parent_pid: int) -> None:
    if os.name == "nt":
        # Windows keeps getppid() unchanged after the parent exits. Wait on the
        # original process object, which also avoids a recycled PID race.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenProcess(0x00100000, False, parent_pid)
        if not handle:
            os._exit(0)
        try:
            while kernel.WaitForSingleObject(handle, 250) == 258:
                pass
        finally:
            kernel.CloseHandle(handle)
        os._exit(0)
    while True:
        if os.getppid() != parent_pid:
            os._exit(0)
        time.sleep(0.25)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18701)
    args = parser.parse_args()
    parent_pid = os.getppid()
    threading.Thread(target=stop_when_parent_exits, args=(parent_pid,), daemon=True).start()
    uvicorn.run("app.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
