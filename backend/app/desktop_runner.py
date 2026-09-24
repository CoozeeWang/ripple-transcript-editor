"""Run Ripple's local API only while its desktop shell is alive."""

import argparse
import os
import threading
import time

import uvicorn


def stop_when_parent_exits(parent_pid: int) -> None:
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
