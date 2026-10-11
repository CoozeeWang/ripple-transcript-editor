"""Generate owner-only tunnel config from the desktop setup form (stdin).

No output secrets. This does not create accounts, tunnels or keys, or download binaries.
"""
import json
import os
import shlex
import sys
from pathlib import Path


def save_setup(data_root: Path, resources: Path, values: dict):
    client = Path(values['client_path']).expanduser().resolve()
    if client.name not in ('tunnel-client', 'tunnel-client.exe') or not client.is_file():
        raise ValueError('Select the official tunnel-client executable')
    tunnel = values['tunnel_id'].strip()
    if not tunnel.startswith('tunnel_') or not tunnel.replace('_', '').isalnum():
        raise ValueError('Invalid tunnel id')
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
            raise ValueError('Invalid runtime key')
        write_private(key_file, key)
    elif not key_file.is_file():
        raise ValueError('Runtime key required')
    python = resources / 'python/bin/python3.12'
    command = shlex.join([str(python), '-m', 'app.connector_mcp', '--credential-file', str(directory / 'client.key')])
    # JSON string scalars are valid YAML; shell command uses shlex quoting, never JSON quoting.
    profile = ('config_version: 1\ncontrol_plane:\n  base_url: "https://api.openai.com"\n'
               f'  tunnel_id: {json.dumps(tunnel)}\n  api_key: {json.dumps("file:" + str(key_file))}\n'
               'health:\n  listen_addr: "127.0.0.1:0"\n'
               f'  url_file: {json.dumps(str(directory / "health.url"))}\n'
               'admin_ui:\n  open_browser: false\nlog:\n  level: warn\n  format: json\n'
               f'mcp:\n  commands:\n    - channel: main\n      command: {json.dumps(command)}\n')
    write_private(directory / 'tunnel.yaml', profile)
    write_private(directory / 'setup.json', json.dumps({'client_path': str(client), 'tunnel_id': tunnel}))


def write_private(path: Path, value: str):
    flags = os.O_NOFOLLOW if hasattr(os, 'O_NOFOLLOW') else 0
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | flags, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(value)


if __name__ == '__main__':
    try:
        save_setup(Path(sys.argv[1]), Path(sys.argv[2]), json.load(sys.stdin))
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        print('Connector setup failed. Check the selected client, tunnel id and runtime key.', file=sys.stderr)
        sys.exit(1)
