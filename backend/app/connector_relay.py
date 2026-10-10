"""Desktop-owned outbound connection. Credentials never enter the WebView.

CLI emits only public pairing state. The worker never logs interview RPC payloads.
"""

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

import httpx

from .connection_service import OPERATIONS, validate_url
from .connector_setup import write_private


def saved(data):
    path = data / "connector/relay.json"
    if path.is_symlink():
        raise ValueError("Invalid credential file")
    return json.loads(path.read_text()) if path.exists() else None


def persist(data, config):
    directory = data / "connector"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise ValueError("Invalid credential directory")
    os.chmod(directory, 0o700)
    temporary = directory / "relay.json.tmp"
    write_private(temporary, json.dumps(config))
    temporary.replace(directory / "relay.json")


async def configure(data, base, action):
    base = validate_url(base)
    config = saved(data)
    if config and config["base_url"] != base:
        raise ValueError("Service changed; revoke the existing pairing first")
    async with httpx.AsyncClient(base_url=base, timeout=10, trust_env=False) as client:
        headers = {"Authorization": "Bearer " + config["device_token"]} if config else {}
        if action == "revoke":
            if config:
                response = await client.delete("/devices", headers=headers)
                if response.status_code != 401:
                    response.raise_for_status()
                (data / "connector/relay.json").unlink(missing_ok=True)
                (data / "connector/relay-status.json").unlink(missing_ok=True)
            return {"paired": False, "available": True}
        if action == "status":
            if not config:
                return {"paired": False, "available": True}
            response = await client.get("/devices/status", headers=headers)
            if response.status_code == 401:
                return {"paired": False, "available": True, "revoked": True}
            response.raise_for_status()
            return dict(response.json(), available=True)
        if action != "pair":
            raise ValueError("Invalid command")
        if config:
            response = await client.post("/devices/pair", headers=headers)
            if response.status_code == 401:
                config = None
        if not config:
            response = await client.post("/devices")
            response.raise_for_status()
            value = response.json()
            config = {
                "base_url": base,
                "device_id": value["device_id"],
                "device_token": value["device_token"],
            }
            # Persist device secret once; raw token is not returned to native UI.
            persist(data, config)
        else:
            response.raise_for_status()
            value = response.json()
        return {
            "paired": False,
            "available": True,
            "pair_code": value["pair_code"],
            "expires_at": value["expires_at"],
        }


async def run_worker(data, local_url):
    # Local destination is fixed by desktop, never by a remote request.
    validate_url(local_url)
    if not local_url.startswith("http://127.0.0.1:"):
        raise ValueError("Local broker required")
    config = saved(data)
    if not config:
        raise ValueError("pairing_required")
    base = validate_url(config["base_url"])
    key = (data / "connector/client.key").read_text().strip()
    if len(key) < 32:
        raise ValueError("Invalid broker credential")
    headers = {"Authorization": "Bearer " + config["device_token"]}
    status_path = data / "connector/relay-status.json"
    status_path.unlink(missing_ok=True)
    pending_reply = None
    delay = 1
    async with (
        httpx.AsyncClient(base_url=base, timeout=30, trust_env=False) as remote,
        httpx.AsyncClient(timeout=130, trust_env=False) as local,
    ):

        async def heartbeat():
            while True:
                try:
                    response = await remote.post("/devices/heartbeat", headers=headers)
                    if response.is_success:
                        write_private(status_path, json.dumps({"ready_at": time.time()}))
                    else:
                        status_path.unlink(missing_ok=True)
                except httpx.HTTPError:
                    status_path.unlink(missing_ok=True)
                await asyncio.sleep(10)

        async def work():
            nonlocal pending_reply, delay
            while True:
                try:
                    if pending_reply:
                        result = await remote.post(
                            "/devices/reply", headers=headers, json=pending_reply
                        )
                        if result.status_code == 401:
                            status_path.unlink(missing_ok=True)
                            return
                        result.raise_for_status()
                        pending_reply = None
                    state = await remote.get("/devices/status", headers=headers)
                    if state.status_code == 401:
                        status_path.unlink(missing_ok=True)
                        return
                    state.raise_for_status()
                    if not state.json()["paired"]:
                        status_path.unlink(missing_ok=True)
                        await asyncio.sleep(1)
                        continue
                    write_private(status_path, json.dumps({"ready_at": time.time()}))
                    response = await remote.get("/devices/jobs", headers=headers)
                    if response.status_code == 401:
                        status_path.unlink(missing_ok=True)
                        return
                    response.raise_for_status()
                    job = response.json()["job"]
                    delay = 1
                    if job:
                        if job.get("operation") not in OPERATIONS or not isinstance(
                            job.get("arguments"), dict
                        ):
                            outcome = {"ok": False, "error": "Invalid Ripple operation"}
                        else:
                            try:
                                answer = await local.post(
                                    local_url + "/api/connector/call",
                                    headers={"Authorization": "Bearer " + key},
                                    json=job,
                                )
                                outcome = (
                                    answer.json()
                                    if answer.is_success
                                    else {
                                        "ok": False,
                                        "error": "Ripple unavailable; check task status before repeating a write",
                                    }
                                )
                            except (httpx.HTTPError, ValueError):
                                # Never dispatch again after an uncertain local result.
                                outcome = {
                                    "ok": False,
                                    "error": "Outcome unknown; check task status before repeating a write",
                                }
                        pending_reply = {"request_id": job["request_id"], "result": outcome}
                except (httpx.HTTPError, ValueError, KeyError):
                    status_path.unlink(missing_ok=True)
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 15)

        pulse = asyncio.create_task(heartbeat())
        try:
            await work()
        finally:
            pulse.cancel()
            await asyncio.gather(pulse, return_exceptions=True)
            status_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["pair", "status", "revoke", "run"])
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--base")
    parser.add_argument("--local", default="http://127.0.0.1:18701")
    args = parser.parse_args()
    if args.action == "run":
        asyncio.run(run_worker(args.data, args.local))
    elif not args.base:
        print(json.dumps({"available": False, "paired": False}))
    else:
        try:
            print(json.dumps(asyncio.run(configure(args.data, args.base, args.action))))
        except (httpx.HTTPError, ValueError, OSError, KeyError):
            print(
                json.dumps({"available": True, "paired": False, "error": "connection_unavailable"})
            )
            raise SystemExit(1)


if __name__ == "__main__":
    main()
