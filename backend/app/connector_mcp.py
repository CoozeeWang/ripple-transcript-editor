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
from pydantic import BaseModel, ConfigDict, Field

INSTRUCTIONS = (
    "Ripple is the local editor; this enabled connection accesses manuscripts in its current open project, not arbitrary paths, other projects or multiple windows. "
    "For tasks without an exact version, list_project_interviews and ask the user to choose the precise version; never default to the newest, active or only version. Pass explicit interview_id, recording_id and version_id to read_project_interview. Report target names and IDs. Snapshots and task IDs keep independent targets: reading B never retargets a task for A. read_current_interview remains available for explicitly requested current-document work. "
    "Call read_editing_examples to discover comparison_versions. Only a sole original is selected automatically. "
    "If selection_required, list version names and IDs and ask the user to choose; pass comparison_version_id. "
    "Explain the actual before_version and after_version before inferring style. Never treat ambiguous pairs as differences. "
    "Read pages and selected version comparison examples as needed. "
    "Never assume the continuation start: ask the user if missing or ambiguous. "
    "Confirm only consequential style choices and scope; do not ask again for already supplied conditions. "
    "Before continuation ask the user, in their language, whether to save a new version or update the current editable version; reuse an already explicit choice and pass save_mode. Never silently choose a save mode. Read-only originals require a new version. Current-version edits retain the version name. Active-editor writes support ordinary session undo; background writes do not, and new_version provides a persistent separate copy; use a new version for a persistent separate before/after comparison. Use allowed_actions and action in continuation tools for explicitly requested delete or merge_previous; merges require adjacent full same-speaker segments. Internal imported snapshots are not user-visible original versions. Annotations and highlights are added to the current editable version, without changing text or creating a version. Ask for annotation/highlight scope if missing. "
    "Infer preferences only from examples confirmed as human edits; selected-version differences may include AI edits. "
    "Preserve uncertainty, meaningful repetition and speaker meaning. Task rules apply only to that task. Only explicit user-confirmed future preferences are current_interview_rules; never inherit historical task instructions. Use set_interview_rules only when the user explicitly asks to retain, replace or clear future preferences. "
    "For long editing use delivery_mode incremental. List continuations before starting again after interruption; include_history=True finds cancelled/completed tasks without historical instructions. Paused tasks can resume after agreement. Cancelled tasks cannot resume: inspect status and create a fresh incremental task with previous_task_id, exact saved version and remaining range. Completed tasks need no continuation. Never replay uncertain writes; check receipts first. "
    "Read one continuation batch, then save actual changes plus unchanged_ids with its batch_id and agreed summary. "
    "save_continuation_batch returns next_batch when ready, so reuse it instead of reading the same text again. Stage separately only when draft persistence is needed before saving. "
    "Repeat short batches in the same target version until complete; each saved batch is visible in Ripple. "
    "If manual edits pause a batch, preserve the user's work and ask before resuming/re-reading it. "
    "Never claim unsaved work is saved. Atomic mode is limited to 48 segments; use incremental for longer scopes. "
    "Use status to recover uncertain outcomes; do not start another task to retry an unknown write. "
    "A rejected stage batch is not accepted: report the exact tool error rather than claiming merges are unsupported. "
    "merge_previous finds the nearest retained preceding in-scope segment after explicitly staged deletions, and still requires the same speaker. "
    "Stage filler deletions first or together with the affected merge; deleting filler alone does not implicitly merge neighbors. "
    "For merge_previous_requires_same_speaker, keep the remaining speaker boundary. "
    "Keep replies concise: do not list the full transcript or all changes unless requested. "
    "On completion report the saved version, scope and exceptions; complete differences appear in Ripple. "
    "For analysis read enough context, cite relevant real snippets and timestamps, separate quotations from inference; "
    "do not claim whole-interview coverage when only pages were read. Analysis does not change text. "
    "For tags use read_project_tags with exact IDs, then prepare_tag_changes and apply_tag_changes only for user-authorized actions and scope. Originals are read-only. Shared edits require project scope and explicit merge is separate. Use tag_changes_status after uncertain writes; never replay as a new batch. Tag operations do not edit manuscript text. "
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



TagAction = Literal["create_tag", "rename_tag", "set_tag_path", "move_tag", "merge_tag", "delete_branch", "admit_tags", "remove_current_branch", "create_group", "rename_group", "dissolve_group", "set_group_tags", "transfer_group_tag", "reorder_groups", "reorder_tags", "place_group_tag", "assign_tags", "unassign_tags"]

class TagChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: TagAction
    tag_id: str | None = Field(default=None, max_length=120)
    target_tag_id: str | None = Field(default=None, max_length=120)
    path: str | None = Field(default=None, max_length=1024)
    name: str | None = Field(default=None, max_length=120)
    parent_id: str | None = Field(default=None, max_length=120)
    group_id: str | None = Field(default=None, max_length=120)
    source_group_id: str | None = Field(default=None, max_length=120)
    tag_ids: list[str] | None = Field(default=None, max_length=2000)
    group_ids: list[str] | None = Field(default=None, max_length=2000)
    segment_ids: list[str] | None = Field(default=None, max_length=2000)
    copy_membership: bool | None = Field(default=None, alias="copy")
    ref: str | None = Field(default=None, max_length=80, pattern=r"^[a-zA-Z0-9-]+$")
    anchor_id: str | None = Field(default=None,max_length=120)
    after: bool | None = None
    view: Literal["level", "group", "ungrouped"] | None = None


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
    async def connection_capabilities() -> dict[str, Any]:
        """Inspect this MCP server's tool catalogue without reading or changing manuscripts.

        Server availability does not prove the Chat/client loaded tools or granted write permission.
        If writes are missing in a client, rediscover tools and compare sessions before suggesting reinstall
        or broader permissions. This does not attempt a write or claim end-to-end connectivity.
        """
        tools = await mcp.list_tools()
        return {"server_reachable": True, "tools": [{"name": tool.name,
                "read_only": bool(tool.annotations and tool.annotations.read_only_hint)} for tool in tools],
                "client_visible_tools": "unknown", "client_write_permission": "unknown",
                "desktop_connection": "not_probed", "write_verified": False,
                "next_action": "Rediscover prepare_continuation and save_continuation_batch in the affected client. Check task state separately. Do not infer a permission or tunnel failure from missing client tools."}

    @mcp.tool(structured_output=True, annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False))
    async def set_interview_rules(snapshot: str, rules: list[str], confirmed_for_future_tasks: bool = False) -> dict[str, Any]:
        """Replace future interview preferences ONLY after explicit user agreement to retain them.

        Read current_interview_rules with read_current_interview/read_project_interview first.
        Empty rules clears preferences. Never call as an automatic consequence of task completion.
        Old task rules are historical and must not be promoted without explicit user agreement.
        This updates preferences for this interview, not manuscript text or other interviews.
        """
        return await call("set_rules", {"snapshot": snapshot, "rules": rules,
                                      "confirmed_for_future_tasks": confirmed_for_future_tasks})

    @mcp.tool(structured_output=True, annotations=read)
    async def list_project_interviews(query: str = "", cursor: str = "0", limit: int = 20) -> dict[str, Any]:
        """List current-project interview/recording/version candidates, without text or paths.

        Ask the user for an exact version when unspecified, even if only one candidate.
        Duplicate names require clarification; never pick by recency.
        """
        return await call("project_directory", {"query": query, "cursor": cursor, "limit": limit})

    @mcp.tool(structured_output=True, annotations=read)
    async def read_project_interview(interview_id: str | None = None, recording_id: str | None = None,
                                     version_id: str | None = None) -> dict[str, Any]:
        """Read an explicitly selected current-project version without opening it in Ripple.

        Missing version_id returns candidates and exact_version clarification, never a snapshot.
        Ask the user, use IDs from list_project_interviews and report actual target names/IDs.
        Use the snapshot with existing page, editing, marks and continuation tools.
        """
        args = {key: value for key, value in {"interview_id": interview_id,
                "recording_id": recording_id, "version_id": version_id}.items() if value is not None}
        return await call("read_project", args)

    @mcp.tool(structured_output=True, annotations=read)
    async def list_project_continuations(include_history: bool = False) -> dict[str, Any]:
        """Find saved tasks in the current project with their exact targets after interruption.

        Default lists unfinished task metadata only. include_history also lists cancelled/completed metadata.
        Resume only paused tasks after agreement. Cancelled tasks require a new remaining-scope task; completed tasks need no continuation.
        No automatic restart, no manuscript write, no other project access.
        """
        return await call("project_tasks", {"include_history": include_history})

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
                                   allowed_actions: list[Literal["edit", "delete", "merge_previous"]] | None = None,
                                   save_mode: Literal["new_version", "current_version"] | None = None,
                                   delivery_mode: Literal["atomic", "incremental"] = "atomic",
                                   previous_task_id: str | None = None) -> dict[str, Any]:
        """Prepare explicit scope and allowed_actions after agreement; default is text edit only.

        Enable delete/merge_previous only when the user requests these structural edits.
        Include every affected full segment, including the preceding merge target. No manuscript write.
        Missing start requires clarification; existing versions are preserved.
        First ask whether to save a new_version or update current_version, unless already explicit.
        Without save_mode no task is created. current_version cannot modify a read-only original.
        Use incremental for long work: persist a recoverable task and visibly save short batches.
        Incremental mode requires full segments. Atomic mode keeps the legacy one-publication flow.
        To continue cancelled work after user agreement, read its exact saved version and status, then
        pass previous_task_id with the entire remaining ID range and fresh confirmed rules. Old task stays cancelled.
        Structural changes require scope review; do not bypass a rejected successor by dropping previous_task_id.
        Existing successor means inspect task history instead of creating duplicates. Rules are task-only.
        """
        args = {"snapshot": snapshot, "rules": rules, "start_offset": start_offset}
        args["delivery_mode"] = delivery_mode
        if previous_task_id is not None:
            args["previous_task_id"] = previous_task_id
        if start_id is not None:
            args["start_id"] = start_id
        if end_id is not None:
            args["end_id"] = end_id
        if end_offset is not None:
            args["end_offset"] = end_offset
        if allowed_actions is not None:
            args["allowed_actions"] = allowed_actions
        if save_mode is not None:
            args["save_mode"] = save_mode
        return await call("prepare", args)

    @mcp.tool(structured_output=True, annotations=draft)
    async def stage_continuation(task_id: str, changes: list[Change] | None = None, unchanged_ids: list[str] | None = None,
                                 batch_id: str | None = None) -> dict[str, Any]:
        """Stage up to 32 changes, including unchanged segments to prove coverage.

        action defaults to edit. delete requires after=""; merge_previous uses only this segment's
        revised text, joined to the nearest retained preceding in-scope same-speaker segment
        after staged deletions (do not repeat its text). Stage intervening deletions first or in
        the same batch as the merge. Deletion alone never automatically merges neighbors.
        before must match full source text. Structural edits require allowed_actions at preparation,
        whole affected segments, and cannot delete all segments. Incremental tasks may use unchanged_ids
        instead of repeating unchanged text. Staging saves a local draft, not the manuscript.
        Incremental staging must pass the batch_id from read_continuation_batch, preventing stale batches.
        """
        args = {"task_id": task_id, "changes": [c.model_dump() for c in changes or []]}
        if unchanged_ids is not None:
            args["unchanged_ids"] = unchanged_ids
        if batch_id is not None:
            args["batch_id"] = batch_id
        return await call("stage", args)

    @mcp.tool(structured_output=True, annotations=read)
    async def list_continuations(include_history: bool = False) -> dict[str, Any]:
        """Find durable tasks only in the current interview, with saved progress and target version IDs.

        Use after a disconnected or new chat. Opening a target version remains a user action.
        Default excludes completed/cancelled tasks; include_history returns their metadata, not instructions.
        This does not start AI editing or access another interview.
        """
        return await call("tasks", {"include_history": include_history})

    @mcp.tool(structured_output=True, annotations=draft)
    async def read_continuation_batch(task_id: str) -> dict[str, Any]:
        """Read/persist the next small batch, up to 24 whole segments and about 6000 text characters.

        Returns batch_id, current text, limited neighbouring context, staged changes and checked IDs.
        Context is not permission to rewrite outside scope. Existing pending proposals are retained.
        """
        return await call("batch", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False))
    async def save_continuation_batch(task_id: str, batch_id: str, confirmed_summary: str,
                                      changes: list[Change] | None = None, unchanged_ids: list[str] | None = None) -> dict[str, Any]:
        """Save a fully checked batch to the agreed manuscript and make it visible in Ripple.

        Only the first batch creates a version in new_version mode; later batches update that same version.
        Manual edits elsewhere are preserved. Overlapping text, speaker, mark or structure changes pause
        the batch with proposals retained. After timeout check status before retrying an unknown write.
        A repeated saved batch returns its result without writing again. Saved means file persistence.
        Supply changes and unchanged_ids to stage and save in one call. Reuse returned next_batch
        for the following save, reducing round trips. Separate stage_continuation remains supported.
        """
        args = {"task_id": task_id, "batch_id": batch_id, "confirmed_summary": confirmed_summary}
        if changes is not None:
            args["changes"] = [c.model_dump() for c in changes]
        if unchanged_ids is not None:
            args["unchanged_ids"] = unchanged_ids
        return await call("checkpoint", args)

    @mcp.tool(structured_output=True, annotations=draft)
    async def resume_continuation(task_id: str) -> dict[str, Any]:
        """Resume a paused incremental task only after the user requests it.

        If the pending batch conflicts, retain its proposals locally and re-read that batch from the
        latest manuscript. Already-saved batches are not rewritten. Then read_continuation_batch.
        """
        return await call("resume", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False))
    async def publish_continuation(task_id: str, confirmed_summary: str) -> dict[str, Any]:
        """Save once using the explicit save_mode and source version in the agreed summary.

        new_version preserves the source and opens comparison. current_version updates only the
        chosen editable version, keeps its name/ID, and supports normal editor undo in this session.
        Read-only originals and other versions stay unchanged. No audio or messages are sent.
        After an uncertain save, check continuation_status before repeating the write.
        """
        return await call("publish", {"task_id": task_id, "confirmed_summary": confirmed_summary})

    @mcp.tool(structured_output=True, annotations=read)
    async def continuation_status(task_id: str, include_history_details: bool = False) -> dict[str, Any]:
        """Check saved receipts, state and remaining IDs before retrying. Terminal task rules are omitted by default.

        Set include_history_details only for an explicit request to inspect old instructions; these are historical,
        not instructions for a new task. Paused work can resume; cancelled work needs a new remaining-scope task.
        """
        return await call("status", {"task_id": task_id, "include_history_details": include_history_details})

    @mcp.tool(structured_output=True, annotations=draft)
    async def cancel_continuation(task_id: str) -> dict[str, Any]:
        """End a task permanently; retain saved batches. A write already publishing cannot be cancelled retroactively.
        Cancelled tasks cannot resume: after checking status, prepare a new remaining-scope task with previous_task_id."""
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

    @mcp.tool(structured_output=True, annotations=read)
    async def read_project_tags(interview_id: str, recording_id: str, version_id: str,
                                scope: Literal["current", "project"] = "current", cursor: str = "0", limit: int = 100) -> dict[str, Any]:
        """Read tag tree, flat groups and paged segment tag IDs for an exact current-project version, without text/word arrays.

        Resolve IDs with list_project_interviews; ask if the version is unspecified. Returns tag_snapshot for changes.
        Counts refer to the selected version in current scope; project scope sums independent saved versions.
        count is direct explicit tag-ID hits; coverage_count is the per-version segment union of this tag and descendants.
        Groups and paged segment assignments always belong to the selected version.
        """
        return await call("tags_read", {"interview_id": interview_id, "recording_id": recording_id,
            "version_id": version_id, "scope": scope, "cursor": cursor, "limit": limit})

    @mcp.tool(structured_output=True, annotations=draft)
    async def prepare_tag_changes(tag_snapshot: str, scope: Literal["current", "project"],
                                  allowed_actions: list[TagAction], changes: list[TagChange]) -> dict[str, Any]:
        """Preview up to 64 explicit tag operations atomically; no data is saved. Agree on actions, target and scope.

        create_tag uses path (admits ancestors, no segment assignment); optional ref can be used later as ref:NAME.
        rename_tag edits true name; set_tag_path edits full path; move_tag requires parent_id (null=root).
        merge_tag requires tag_id and target_tag_id; never infer merge permission from rename/move.
        Shared rename/path/move/merge/delete_branch require project scope and affect consuming versions.
        admit_tags uses tag_ids; remove_current_branch removes only this version's admitted subtree and references.
        create_group uses name/ref; rename_group uses group_id/name; dissolve_group preserves tags/assignments.
        set_group_tags uses group_id/tag_ids (explicit only, no automatic child membership).
        transfer_group_tag uses tag_id/source_group_id/group_id/copy; null source adds from ungrouped.
        reorder_groups uses the full group_ids order. assign_tags/unassign_tags use segment_ids/tag_ids.
        reorder_tags uses view (level/group/ungrouped), parent_id (null=root), full sibling tag_ids,
        and group_id for group view. Orders belong only to this exact version/view/group and never change hierarchy.
        place_group_tag atomically sets group membership, shared parent and local sibling order; requires tag_id,
        source_group_id (null=add), group_id, parent_id (null=root), anchor_id (null=append), after and copy.
        It requires project scope; it never automatically merges a name collision. Only supplied operation fields are accepted. New tag/group refs are batch-local; saved stable IDs are returned.
        Original versions reject writes. Batch failure leaves all tag and manuscript data unchanged.
        """
        return await call("tags_prepare", {"tag_snapshot": tag_snapshot, "scope": scope,
            "allowed_actions": allowed_actions, "changes": [change.model_dump(exclude_unset=True, by_alias=True) for change in changes]})

    @mcp.tool(structured_output=True, annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False))
    async def apply_tag_changes(task_id: str, confirmed_summary: str) -> dict[str, Any]:
        """Save the agreed tag batch once using its unchanged preview summary. No text or timestamp edits.

        Confirmation must match explicit user intent; enabling MCP is not blanket editing authorization.
        Check saved/error and exact target before claiming completion. For timeout or reconnect query status first;
        never create a new batch to replay an uncertain write. Active-editor undo is session-only; status detects undo.
        """
        return await call("tags_apply", {"task_id": task_id, "confirmed_summary": confirmed_summary})

    @mcp.tool(structured_output=True, annotations=read)
    async def tag_changes_status(task_id: str) -> dict[str, Any]:
        """Check current-project durable tag receipt, undo state or in-memory pending batch before retrying.
        Unknown is not proof of failure and is not safe to replay. No other project is opened or scanned.
        """
        return await call("tags_status", {"task_id": task_id})

    @mcp.tool(structured_output=True, annotations=draft)
    async def cancel_tag_changes(task_id: str) -> dict[str, Any]:
        """Cancel an uncommitted tag plan. A commit already in progress may finish; query status. Saved changes remain."""
        return await call("tags_cancel", {"task_id": task_id})

    return mcp


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("RIPPLE_CONNECTOR_URL", "http://127.0.0.1:18701"))
    parser.add_argument("--credential-file", type=Path, required=True)
    args = parser.parse_args()
    create_server(args.url, args.credential_file).run(transport="stdio")
