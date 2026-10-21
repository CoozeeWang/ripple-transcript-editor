"""Generate owner-only tunnel config from the desktop setup form (stdin).

No output secrets. This does not create accounts, tunnels or keys, or download binaries.
"""
import json
import os
import shlex
import sys
import hashlib
import shutil
import tempfile
from pathlib import Path

from .bundled_runtime import bundled_python
from .atomic_files import atomic_write_text


class SetupError(ValueError):
    """Only fixed public error codes cross the desktop subprocess boundary."""


def save_setup(data_root: Path, resources: Path, values: dict):
    if not isinstance(values, dict) or any(not isinstance(values.get(name), str)
                                          for name in ('client_path', 'tunnel_id')):
        raise SetupError('setup_input_invalid')
    client = Path(values['client_path']).expanduser().resolve()
    if client.name not in ('tunnel-client', 'tunnel-client.exe') or not client.is_file():
        raise SetupError('setup_client_invalid')
    if os.name != 'nt' and not os.access(client, os.X_OK):
        raise SetupError('setup_client_invalid')
    tunnel = values['tunnel_id'].strip()
    if not tunnel.startswith('tunnel_') or not tunnel.replace('_', '').isalnum():
        raise SetupError('setup_tunnel_invalid')
    if not isinstance(values.get('runtime_key', ''), str):
        raise SetupError('setup_key_invalid')
    directory = data_root / 'connector'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise ValueError('Invalid connector directory')
    os.chmod(directory, 0o700)
    key_file = directory / 'runtime.key'
    key = values.get('runtime_key', '').strip()
    if key:
        # Recover exactly duplicated pastes without exposing the value.
        if len(key) % 2 == 0 and key[:len(key)//2] == key[len(key)//2:]:
            key = key[:len(key)//2]
        if any(c.isspace() for c in key) or len(key) < 32:
            raise SetupError('setup_key_invalid')
    elif not key_file.is_file():
        raise SetupError('setup_key_invalid')
    client = retain_runtime(directory, client)
    if key:
        write_private(key_file, key)
    python = bundled_python(resources)
    arguments = [str(python), '-m', 'app.connector_mcp', '--url', os.environ.get('RIPPLE_CONNECTOR_URL', 'http://127.0.0.1:18701'), '--credential-file', str(directory / 'client.key')]
    # tunnel-client parses this string using shell-word rules on every platform,
    # before invoking a process without a shell. Windows CRT quoting would lose
    # backslashes here. JSON encodes the YAML scalar; shlex quotes its contents.
    command = shlex.join(arguments)
    profile = ('config_version: 1\ncontrol_plane:\n  base_url: "https://api.openai.com"\n'
               f'  tunnel_id: {json.dumps(tunnel)}\n  api_key: {json.dumps("file:" + str(key_file))}\n'
               'health:\n  listen_addr: "127.0.0.1:0"\n'
               f'  url_file: {json.dumps(str(directory / "health.url"))}\n'
               'admin_ui:\n  open_browser: false\nlog:\n  level: warn\n  format: json\n'
               f'mcp:\n  commands:\n    - channel: main\n      command: {json.dumps(command)}\n')
    write_private(directory / 'tunnel.yaml', profile)
    write_private(directory / 'setup.json', json.dumps({'client_path': str(client), 'tunnel_id': tunnel}))
    from .connector_config import enable_client
    enable_client(data_root, 'chatgpt')


def write_private(path: Path, value: str):
    if path.is_symlink():
        raise SetupError('setup_write_failed')
    atomic_write_text(path, value, private=True)


def retain_runtime(directory: Path, client: Path) -> Path:
    """Keep the selected official runtime outside replaceable app/download folders.

    Copy only its executables and licensing/manifest companions. No download,
    account change or global install; old versions remain available for rollback.
    """
    root = directory / 'runtimes'
    if root.is_symlink():
        raise SetupError('setup_write_failed')
    root.mkdir(mode=0o700, exist_ok=True)
    if client.is_relative_to(root.resolve()):
        return client
    names = {client.name, 'cloudflared.exe' if client.suffix == '.exe' else 'cloudflared',
             'cloudflared-manifest.json', 'LICENSE', 'NOTICE'}
    files = sorted((p for p in client.parent.iterdir() if p.is_file() and not p.is_symlink()
                    and (p.name in names or (p.name.startswith('tunnel-client-v')
                         and p.name.endswith(('-licenses.txt', '.spdx.json'))))), key=lambda p: p.name)
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.name.encode('utf-8'))
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    destination = root / digest.hexdigest()
    if not destination.exists():
        stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=root))
        try:
            for path in files:
                shutil.copy2(path, stage / path.name)
            stage.rename(destination)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    retained = destination / client.name
    if not retained.is_file():
        raise SetupError('setup_client_invalid')
    return retained


if __name__ == '__main__':
    try:
        # Rust writes UTF-8 bytes. Windows stdin may otherwise decode them as GBK.
        values = json.loads(sys.stdin.buffer.read().decode('utf-8'))
        save_setup(Path(sys.argv[1]), Path(sys.argv[2]), values)
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        code = str(error) if isinstance(error, SetupError) else (
            'setup_write_failed' if isinstance(error, OSError) else 'setup_input_invalid')
        print(json.dumps({'error': code}))
        sys.exit(1)
