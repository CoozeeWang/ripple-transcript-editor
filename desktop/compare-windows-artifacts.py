"""Compare static payload reports without opening or executing an installer."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_manifest(path: Path) -> dict[str, dict]:
    entries = json.loads(path.read_text(encoding="utf-8-sig"))
    result = {}
    for entry in entries:
        name = entry["name"].replace("\\", "/").casefold()
        if name in result:
            raise ValueError("Duplicate Windows payload path")
        result[name] = entry
    return result


def compare(old: dict[str, dict], new: dict[str, dict]) -> dict:
    common = old.keys() & new.keys()
    changed = sorted(name for name in common if old[name]["sha256"] != new[name]["sha256"])
    added = sorted(new.keys() - old.keys())
    removed = sorted(old.keys() - new.keys())
    binary = lambda name: name.endswith((".exe", ".dll", ".pyd"))
    packages = lambda manifest: sorted({part for name in manifest for part in name.split("/") if part.endswith(".dist-info")})
    return {
        "installerExecuted": False,
        "browserVerdict": "not assessed",
        "oldFileCount": len(old), "newFileCount": len(new),
        "identicalFileCount": len(common) - len(changed),
        "added": added, "removed": removed, "changed": changed,
        "binaryChanges": {"added": [x for x in added if binary(x)],
                          "removed": [x for x in removed if binary(x)],
                          "changed": [x for x in changed if binary(x)]},
        "oldPackages": packages(old), "newPackages": packages(new),
        "changedHashes": {name: {"old": old[name]["sha256"], "new": new[name]["sha256"]} for name in changed},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = compare(load_manifest(args.old), load_manifest(args.new))
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
