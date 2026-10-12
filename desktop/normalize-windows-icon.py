"""Preserve approved artwork; Tauri decodes the first ICO frame as its window icon."""
import argparse
from pathlib import Path
import struct


def normalized(data: bytes) -> bytes:
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved != 0 or kind != 1 or count < 1:
        raise ValueError('Invalid ICO')
    entries = [data[6 + i * 16:22 + i * 16] for i in range(count)]
    if any(len(entry) != 16 for entry in entries):
        raise ValueError('Truncated ICO')
    entries.sort(key=lambda entry: (entry[0] or 256) * (entry[1] or 256), reverse=True)
    return data[:6] + b''.join(entries) + data[6 + count * 16:]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = Path(__file__).parent / 'src-tauri/icons/icon.ico'
    before = path.read_bytes()
    after = normalized(before)
    if args.check:
        if before != after:
            raise SystemExit('Windows ICO must place its highest-resolution frame first')
    else:
        path.write_bytes(after)
