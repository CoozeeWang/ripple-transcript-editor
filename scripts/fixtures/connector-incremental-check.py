"""Synthetic phased SDK check; no model or real interview."""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    root = Path(os.environ["RIPPLE_CONNECTOR_TEST_DIR"])
    context_path = root / "incremental-context.json"
    parameters = StdioServerParameters(command=sys.executable, args=[
        "-m", "app.connector_mcp", "--url", os.environ["RIPPLE_CONNECTOR_TEST_URL"],
        "--credential-file", str(root / "data/connector/client.key"),
    ], env={"PYTHONPATH": str(Path("backend").resolve()), "PYTHONDONTWRITEBYTECODE": "1"})
    async with stdio_client(parameters) as (read, write), ClientSession(read, write) as client:
        await client.initialize()

        async def call(name, arguments):
            result = await client.call_tool(name, arguments)
            assert not result.is_error, str(result.content)
            return result.structured_content

        phase = os.environ["RIPPLE_INCREMENTAL_PHASE"]
        if phase == "prepare":
            current = await call("read_current_interview", {})
            assert current["segment_count"] == 60
            context = await call("prepare_continuation", {
                "snapshot": current["snapshot"], "start_id": "s1", "rules": ["Synthetic phased editing"],
                "save_mode": "new_version", "delivery_mode": "incremental",
            })
        else:
            context = json.loads(context_path.read_text())
            found = await call("list_continuations", {})
            assert any(t["task_id"] == context["task_id"] for t in found["tasks"])
        if phase in {"prepare", "stage"}:
            batch = await call("read_continuation_batch", {"task_id": context["task_id"]})
            segment = batch["segments"][0]
            result = await call("stage_continuation", {
                "task_id": context["task_id"], "batch_id": batch["batch_id"],
                "changes": [{"segment_id": segment["id"], "before": segment["text"], "after": segment["text"] + " Synthetic AI checkpoint."}],
                "unchanged_ids": [s["id"] for s in batch["segments"][1:]],
            })
            assert result["draft_saved"]
            context["batch_id"] = batch["batch_id"]
            context_path.write_text(json.dumps(context))
            print(json.dumps({"batch_id": batch["batch_id"], "first": segment["id"], "staged": result["staged"]}))
        else:
            result = await call("save_continuation_batch", {
                "task_id": context["task_id"], "batch_id": context["batch_id"], "confirmed_summary": context["summary"],
            })
            if phase == "conflict":
                assert result["state"] == "paused" and result["conflict"] and not result["saved"]
            else:
                assert result["saved"]
                assert (await call("save_continuation_batch", {
                    "task_id": context["task_id"], "batch_id": context["batch_id"], "confirmed_summary": context["summary"],
                }))["repeated"]
            print(json.dumps({k: result.get(k) for k in ["state", "saved", "saved_segments", "result_version", "conflict"]}))


asyncio.run(main())
