"""Ripple MCP stdio adapter. Reads a credential file, never transcript files."""
import argparse
import os
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ConfigDict

INSTRUCTIONS = (
    "Ripple is the local editor; this connection only accesses its explicitly enabled current interview. "
    "Call read_current_interview; its current_version is the continuation target. "
    "Call read_editing_examples to discover comparison_versions. Only a sole original is selected automatically. "
    "If selection_required, list version names and IDs and ask the user to choose; pass comparison_version_id. "
    "Explain the actual before_version and after_version before inferring style. Never treat ambiguous pairs as differences. "
    "Read pages and selected version comparison examples as needed. "
    "Never assume the continuation start: ask the user if missing or ambiguous. "
    "Confirm only consequential style choices and scope; do not ask again for already supplied conditions. "
    "Text and segment-structure edits always save a new version. Use allowed_actions and action in continuation tools for explicitly requested delete or merge_previous; merges require adjacent full same-speaker segments. Internal imported snapshots are not user-visible original versions. Annotations and highlights are added to the current editable version, without changing text or creating a version. Ask for annotation/highlight scope if missing. "
    "Infer preferences only from examples confirmed as human edits; selected-version differences may include AI edits. "
    "Preserve uncertainty, meaningful repetition and speaker meaning. Rules remain in the current interview/task. "
    "Prepare a task, stage every in-scope segment including unchanged ones, publish once only after agreement. "
    "Use status to recover uncertain outcomes; do not start another task to retry an unknown write. "
    "A rejected stage batch is not accepted: report the exact tool error rather than claiming merges are unsupported. "
    "merge_previous finds the nearest retained preceding in-scope segment after explicitly staged deletions, and still requires the same speaker. "
    "Stage filler deletions first or together with the affected merge; deleting filler alone does not implicitly merge neighbors. "
    "For merge_previous_requires_same_speaker, keep the remaining speaker boundary. "
    "Keep replies concise: do not list the full transcript or all changes unless requested. "
    "On completion report the saved version, scope and exceptions; complete differences appear in Ripple. "
    "For analysis read enough context, cite relevant real snippets and timestamps, separate quotations from inference; "
    "do not claim whole-interview coverage when only pages were read. Analysis does not change text. "
    "Conversational summary matching records agreement, not proof of a human identity."
)


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: str
    before: str
    after: str
    action: Literal["edit", "delete", "merge_previous"] = "edit"


class MarkHighlight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: int
    end: int
    text: str

class Mark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: str
    before: str
    annotation: str | None = None
    highlights: list[MarkHighlight] = []


def create_server(url: str, credential_file: Path):
    parsed = urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username:
        raise ValueError("Ripple connector endpoint must be local HTTP")
    token = credential_file.read_text().strip()
    if len(token) < 32:
        raise ValueError("Invalid connector credential")
    mcp = MCPServer("Ripple", instructions=INSTRUCTIONS)

    async def call(operation: str, arguments: dict):
        async with httpx.AsyncClient(timeout=130, trust_env=False) as client:
            try:
                response = await client.post(f"{url.rstrip('/')}/api/connector/call",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"request_id": uuid.uuid4().hex, "operation": operation, "arguments": arguments})
            except httpx.HTTPError as error:
                raise ToolError("Ripple connection unavailable. For writes, check task status before retrying.") from error
        if not response.is_success:
            detail = response.json().get("detail", "connection_unavailable") if response.headers.get("content-type", "").startswith("application/json") else "connection_unavailable"
            raise ToolError(f"Ripple connector unavailable ({response.status_code}): {detail}. Check MCP connection status in Ripple; do not retry an uncertain write without checking task status.")
        result = response.json()
        if not result.get("ok"):
            raise ToolError(result.get("error", "Ripple operation failed"))
        return result["data"]

    return register_tools(mcp, call)


def register_tools(mcp, call):
    """Register the same tool contract for local stdio and authenticated relay."""
    read = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
    draft = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
    write = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

    @mcp.tool(structured_output=True, annotations=read)
    async def read_current_interview() -> dict[str, Any]:
        """Return current interview summary and an opaque snapshot, not the entire transcript."""
        return await call("read_current", {})

    @mcp.tool(structured_output=True, annotations=read)
    async def read_interview_page(snapshot: str, cursor: str = "0:0", max_chars: int = 6000) -> dict[str, Any]:
        """Read ordered text pages, without word-level timing arrays. Follow next_cursor to continue."""
        return await call("read_page", {"snapshot": snapshot, "cursor": cursor, "max_chars": max_chars})

    @mcp.tool(structured_output=True, annotations=read)
    async def read_editing_examples(snapshot: str, segment_ids: list[str],
                                   comparison_version_id: str | None = None) -> dict[str, Any]:
        """Compare selected segments to an explicit version. Use segment_ids=[] to list candidates.

        A sole original is automatic; otherwise ask the user to select comparison_version_id.
        Returns named before/after version IDs, unchanged/changed pairs or mapping failure reasons.
        Confirm human authorship (especially mixed/AI edits) before learning personal preferences.
        """
        args = {"snapshot": snapshot, "segment_ids": segment_ids}
        if comparison_version_id is not None:
            args["comparison_version_id"] = comparison_version_id
        return await call("read_examples", args)

    @mcp.tool(structured_output=True, annotations=draft)
    async def prepare_continuation(snapshot: str, rules: list[str], start_id: str | None = None,
                                   start_offset: int = 0, end_id: str | None = None,
                                   end_offset: int | None = None,
                                   allowed_actions: list[Literal["edit", "delete", "merge_previous"]] | None = None) -> dict[str, Any]:
        """Prepare explicit scope and allowed_actions after agreement; default is text edit only.

        Enable delete/merge_previous only when the user requests these structural edits.
        Include every affected full segment, including the preceding merge target. No manuscript write.
        Missing start requires clarification; existing versions are preserved.
        """
        args = {"snapshot": snapshot, "rules": rules, "start_offset": start_offset}
        if start_id is not None:
            args["start_id"] = start_id
        if end_id is not None:
            args["end_id"] = end_id
        if end_offset is not None:
            args["end_offset"] = end_offset
        if allowed_actions is not None:
            args["allowed_actions"] = allowed_actions
        return await call("prepare", args)

    @mcp.tool(structured_output=True, annotations=draft)
    async def stage_continuation(task_id: str, changes: list[Change]) -> dict[str, Any]:
        """Stage up to 32 changes, including unchanged segments to prove coverage.

        action defaults to edit. delete requires after=""; merge_previous uses only this segment's
        revised text, joined to the nearest retained preceding in-scope same-speaker segment
        after staged deletions (do not repeat its text). Stage intervening deletions first or in
        the same batch as the merge. Deletion alone never automatically merges neighbors.
        before must match full source text. Structural edits require allowed_actions at preparation,
        whole affected segments, and cannot delete all segments. Writes occur only at publication.
        """
        return await call("stage", {"task_id": task_id, "changes": [c.model_dump() for c in changes]})

    @mcp.tool(structured_output=True, annotations=write)
    async def publish_continuation(task_id: str, confirmed_summary: str) -> dict[str, Any]:
        """Save staged text as ONE new local Ripple version after user agreement. Only the current interview is affected. Existing versions are never overwritten or deleted; no messages, audio, or data are sent to other services. Open comparison against the source version."""
        return await call("publish", {"task_id": task_id, "confirmed_summary": confirmed_summary})

    @mcp.tool(structured_output=True, annotations=read)
    async def continuation_status(task_id: str) -> dict[str, Any]:
        """Recover interrupted/uncertain tasks and find remaining segments or the already-saved result."""
        return await call("status", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=draft)
    async def cancel_continuation(task_id: str) -> dict[str, Any]:
        """Cancel an unpublished task. A write already publishing cannot be cancelled retroactively."""
        return await call("cancel", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=draft)
    async def prepare_interview_marks(snapshot: str, instructions: str, segment_ids: list[str] | None = None, whole_interview: bool = False) -> dict[str, Any]:
        """Prepare annotations/highlights for explicitly requested segments or whole interview. No text changes or new versions. Missing scope requires clarification."""
        args: dict[str, Any] = {"snapshot": snapshot, "instructions": instructions, "whole_interview": whole_interview}
        if segment_ids is not None:
            args["segment_ids"] = segment_ids
        return await call("prepare_marks", args)

    @mcp.tool(structured_output=True, annotations=draft)
    async def stage_interview_marks(task_id: str, marks: list[Mark]) -> dict[str, Any]:
        """Stage up to 32 segments, including empty marks for reviewed segments. before must match full current text. Highlight start/end are UTF-16 offsets, end exclusive, on grapheme boundaries; text must match that range. Existing marks are preserved."""
        return await call("stage_marks", {"task_id": task_id, "marks": [mark.model_dump() for mark in marks]})

    @mcp.tool(structured_output=True, annotations=write)
    async def apply_interview_marks(task_id: str, confirmed_summary: str) -> dict[str, Any]:
        """Add staged marks ONCE to the current Ripple version after agreement, save, and open its sidebar. No text/timestamp changes or new version. AI annotations are identified; human marks are retained. Check saved/error before claiming success; failed saves must be recovered in Ripple."""
        return await call("apply_marks", {"task_id": task_id, "confirmed_summary": confirmed_summary})

    @mcp.tool(structured_output=True, annotations=read)
    async def interview_marks_status(task_id: str) -> dict[str, Any]:
        """Recover mark task state, remaining segments and saved/failed result before retrying uncertain writes."""
        return await call("marks_status", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=draft)
    async def cancel_interview_marks(task_id: str) -> dict[str, Any]:
        """Cancel a draft annotation/highlight task; cannot undo a write already being applied."""
        return await call("cancel_marks", {"task_id": task_id})

    return mcp


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("RIPPLE_CONNECTOR_URL", "http://127.0.0.1:18701"))
    parser.add_argument("--credential-file", type=Path, required=True)
    args = parser.parse_args()
    create_server(args.url, args.credential_file).run(transport="stdio")
