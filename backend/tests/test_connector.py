"""Synthetic bridge tests: no real paths, interviews, or credentials."""
import asyncio
import os
import time

import pytest
from fastapi import HTTPException

from app.connector import LEASE_SECONDS, Broker, Window


def test_roles_are_separate_and_no_unknown_key_is_accepted():
    b = Broker()
    b.window_key, b.client_key = 'w' * 48, 'c' * 48
    b.authorize('Bearer ' + 'w' * 48, 'window')
    b.authorize('Bearer ' + 'c' * 48, 'client')
    for key, role in [('w', 'client'), ('c', 'window'), ('x', 'client')]:
        with pytest.raises(HTTPException) as error:
            b.authorize('Bearer ' + key * 48, role)
        assert error.value.status_code == 401


def test_closed_expired_or_ambiguous_windows_are_rejected():
    b = Broker()
    for windows in [{}, {'expired': Window(time.monotonic() - LEASE_SECONDS - 1)},
                    {'one': Window(time.monotonic()), 'two': Window(time.monotonic())}]:
        b.windows = windows
        with pytest.raises(HTTPException):
            b.current()


def test_retries_dispatch_only_once_and_reused_id_with_new_payload_is_rejected():
    async def run():
        b = Broker(); b.windows['synthetic-window'] = Window(time.monotonic())
        one = asyncio.create_task(b.call('synthetic-request', 'publish', {'task_id': 't'}))
        two = asyncio.create_task(b.call('synthetic-request', 'publish', {'task_id': 't'}))
        command = await b.windows['synthetic-window'].queue.get()
        owner, future = b.pending[command['request_id']]
        assert owner == 'synthetic-window'
        future.set_result({'ok': True, 'data': {'version': 'v1-AI-ed'}})
        assert await one == await two
        assert b.windows['synthetic-window'].queue.empty()
        assert await b.call('synthetic-request', 'publish', {'task_id': 't'}) == await one
        with pytest.raises(HTTPException):
            await b.call('synthetic-request', 'publish', {'task_id': 'other'})
    asyncio.run(run())


def test_disable_unblocks_requests_without_routing_to_another_window():
    async def run():
        b = Broker(); b.windows['synthetic-window'] = Window(time.monotonic())
        task = asyncio.create_task(b.call('synthetic-request', 'read_current', {}))
        await b.windows['synthetic-window'].queue.get()
        b.disable('synthetic-window')
        assert await task == {'ok': False, 'error': 'connection_disabled'}
        assert not b.pending
    asyncio.run(run())


def test_authenticated_client_is_forwarded_outside_client_supplied_arguments():
    async def run():
        b = Broker(); b.windows['synthetic-window'] = Window(time.monotonic())
        pending = asyncio.create_task(b.call('synthetic-authenticated-request', 'prepare_marks', {'client': 'claude'}, 'chatgpt'))
        command = await b.windows['synthetic-window'].queue.get()
        assert command['client'] == 'chatgpt'
        b.pending[command['request_id']][1].set_result({'ok': True, 'data': {}})
        await pending
    asyncio.run(run())


def test_owner_only_setup_escapes_paths_and_never_puts_keys_in_yaml(tmp_path):
    from app.connector_setup import save_setup
    client = tmp_path / 'client with spaces' / 'tunnel-client'
    client.parent.mkdir()
    client.write_text('synthetic executable fixture')
    client.chmod(0o700)
    root = tmp_path / 'Synthetic data'
    resources = tmp_path / 'Synthetic resources'
    key = 'synthetic-not-a-real-key-' * 3
    save_setup(root, resources, {'client_path': str(client), 'tunnel_id': 'tunnel_synthetic',
                                 'runtime_key': key + key})
    assert (root / 'connector/runtime.key').read_text() == key
    profile = (root / 'connector/tunnel.yaml').read_text()
    assert key not in profile
    assert 'file:' in profile and 'app.connector_mcp' in profile
    if os.name != "nt":
        assert (root / 'connector/runtime.key').stat().st_mode & 0o777 == 0o600
    save_setup(root, resources, {'client_path': str(client), 'tunnel_id': 'tunnel_synthetic', 'runtime_key': ''})
    assert (root / 'connector/runtime.key').read_text() == key


def test_setup_rejects_untrusted_client_name_and_malformed_tunnel(tmp_path):
    from app.connector_setup import save_setup
    client = tmp_path / 'other-program'
    client.write_text('synthetic fixture')
    with pytest.raises(ValueError):
        save_setup(tmp_path / 'data', tmp_path, {'client_path': str(client), 'tunnel_id': 'bad',
                                              'runtime_key': 'synthetic-key-' * 4})


@pytest.mark.skipif(os.name == 'nt', reason='Unix executable permissions')
def test_setup_rejects_non_executable_before_saving_any_configuration(tmp_path):
    from app.connector_setup import save_setup
    client = tmp_path / 'tunnel-client'
    client.write_text('Synthetic non-executable fixture, never run')
    client.chmod(0o600)
    root = tmp_path / 'data'
    with pytest.raises(ValueError, match='executable'):
        save_setup(root, tmp_path, {'client_path': str(client), 'tunnel_id': 'tunnel_synthetic',
                                   'runtime_key': 'synthetic-key-' * 4})
    assert not (root / 'connector').exists()


def test_mcp_discovery_exposes_structured_tools_and_safe_write_annotations(tmp_path):
    from app.connector_mcp import create_server
    key_file = tmp_path / 'synthetic-client.key'
    key_file.write_text('synthetic-not-real-credential-' * 3)
    server = create_server('http://127.0.0.1:18701', key_file)
    tools = asyncio.run(server.list_tools())
    assert len(tools) == 20
    publish = next(tool for tool in tools if tool.name == 'publish_continuation')
    assert publish.output_schema is not None
    assert publish.annotations.idempotent_hint
    # It can now update the chosen editable version; clients must see that write capability.
    assert publish.annotations.destructive_hint
    prepare = next(tool for tool in tools if tool.name == 'prepare_continuation')
    assert 'save_mode' in prepare.input_schema['properties']
    assert 'delivery_mode' in prepare.input_schema['properties']
    assert {'list_continuations','read_continuation_batch','save_continuation_batch','resume_continuation'} <= {t.name for t in tools}
    checkpoint = next(t for t in tools if t.name == 'save_continuation_batch')
    assert checkpoint.annotations.idempotent_hint and checkpoint.annotations.destructive_hint
    read = next(tool for tool in tools if tool.name == 'read_current_interview')
    assert read.annotations.read_only_hint
    project_read = next(t for t in tools if t.name == 'read_project_interview')
    assert project_read.annotations.read_only_hint
    assert 'version_id' in project_read.input_schema['properties']
    assert 'version_id' not in project_read.input_schema.get('required', [])
    assert {'list_project_interviews', 'list_project_continuations'} <= {t.name for t in tools}
    # Optional at the schema boundary so omission can return a user clarification, not a write.
    assert 'save_mode' not in prepare.input_schema.get('required', [])
    examples = next(tool for tool in tools if tool.name == 'read_editing_examples')
    assert 'comparison_version_id' in examples.input_schema['properties']
    assert 'comparison_version_id' not in examples.input_schema.get('required', [])
    assert examples.annotations.read_only_hint
    assert 'sole original' in examples.description


def test_disabling_clears_replay_results_and_new_window_cannot_replay_old_reads():
    async def run():
        b = Broker(); b.windows['synthetic-one'] = Window(time.monotonic())
        task = asyncio.create_task(b.call('synthetic-read', 'read_page', {}))
        command = await b.windows['synthetic-one'].queue.get()
        b.pending[command['request_id']][1].set_result({'ok': True, 'data': {'text': 'synthetic'}})
        await task
        b.disable('synthetic-one')
        assert not b.calls
        with pytest.raises(HTTPException):
            await b.call('synthetic-read', 'read_page', {})
    asyncio.run(run())


def test_mark_schema_and_current_version_instructions(tmp_path):
    from pydantic import ValidationError

    from app.connector_mcp import INSTRUCTIONS, Mark, create_server
    key = tmp_path / 'credential'
    key.write_text('x' * 48)
    tools = asyncio.run(create_server('http://127.0.0.1:18701', key).list_tools())
    apply = next(tool for tool in tools if tool.name == 'apply_interview_marks')
    assert apply.annotations.idempotent_hint is True
    assert apply.annotations.destructive_hint is False
    assert 'current editable version' in INSTRUCTIONS
    with pytest.raises(ValidationError):
        Mark(segment_id='a', before='Synthetic', after='forbidden')


def test_structural_continuation_schema_and_backward_compatible_default(tmp_path):
    from pydantic import ValidationError

    from app.connector_mcp import Change, create_server
    key = tmp_path / 'synthetic.key'
    key.write_text('x' * 48)
    tools = asyncio.run(create_server('http://127.0.0.1:18702', key).list_tools())
    prepare = next(t for t in tools if t.name == 'prepare_continuation')
    stage = next(t for t in tools if t.name == 'stage_continuation')
    assert 'allowed_actions' in prepare.input_schema['properties']
    assert 'allowed_actions' not in prepare.input_schema.get('required', [])
    assert set(stage.input_schema['$defs']['Change']['properties']['action']['enum']) == {'edit', 'delete', 'merge_previous'}
    assert Change(segment_id='s', before='Synthetic', after='Synthetic').action == 'edit'
    assert Change(segment_id='s', before='Synthetic', after='', action='delete').action == 'delete'
    with pytest.raises(ValidationError):
        Change(segment_id='s', before='Synthetic', after='', action='delete_file')
