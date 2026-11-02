#!/usr/bin/env python3
"""Install the mod and its shortcut, preserving unrelated files and keys.

No layout change is needed: the shortcut opens the mod with `mod.open`.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
MOD_NAME = "float-space"
MARKER = ".float-space-install.json"
FILES = ("main.js", "controller.js", "model.js", "mod.json", "float.svg", "plus.svg", "notes.svg", "size.svg", "hide.svg", "spinner.svg", "close.svg")
GENERATED = {"gpui-kit.d.ts", "jsconfig.json"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".float-space-", delete=False) as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
        temp = Path(stream.name)
    temp.replace(path)


def merge_keys(existing, snippet):
    merged = json.loads(json.dumps(existing))
    for section, bindings in snippet.items():
        target = merged.setdefault(section, {})
        for key, action in bindings.items():
            if key in target and target[key] != action:
                raise ValueError(f"Shortcut conflict in {section}: {key} is {target[key]!r}. No files changed.")
            target[key] = action
    return merged


def verify_installed(destination, marker):
    if marker.get("package") != "herdr-float-space":
        raise ValueError("The existing mod belongs to another package")
    known = set(marker["files"]) | GENERATED | {MARKER}
    for path in destination.iterdir():
        if path.name not in known:
            raise ValueError(f"Extra installed file would be replaced: {path}. Preserve it before updating.")
    for filename, expected in marker["files"].items():
        if filename in GENERATED:
            continue
        path = destination / filename
        if not path.is_file() or digest(path) != expected:
            raise ValueError(f"Installed file was edited: {path}. Preserve that edit before updating.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", type=Path, default=Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app")))
    parser.add_argument("--update", action="store_true", help="Update files previously installed by this script")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    app = args.app_home.expanduser().resolve()
    env = {**os.environ, "HERDR_APP_HOME": str(app)}
    keys_path = app / "keys.json"
    keys = merge_keys(json.loads(keys_path.read_text()), json.loads((ROOT / "keys.json").read_text()))
    source = ROOT / "mods" / MOD_NAME
    destination = app / "mods" / MOD_NAME
    if destination.exists():
        marker_path = destination / MARKER
        if not args.update or not marker_path.exists():
            raise ValueError(f"{destination} already exists. Use --update only for this installer's own files.")
        marker = json.loads(marker_path.read_text())
        verify_installed(destination, marker)
    subprocess.run(["herdr-app", "check", str(source)], env=env, check=True)
    print(f"Mod: {destination}\nShortcut: Ctrl+Shift+Space")
    if args.dry_run:
        print("Dry run: no files changed.")
        return
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = app / "backups" / MOD_NAME / stamp
    backup.mkdir(parents=True)
    shutil.copy2(keys_path, backup / "keys.json")
    if destination.exists():
        shutil.copytree(destination, backup / MOD_NAME)
    stage = Path(tempfile.mkdtemp(prefix=".float-space-stage-", dir=app))
    previous = app / f".float-space-previous-{stamp}"
    replaced = False
    try:
        for filename in FILES:
            shutil.copy2(source / filename, stage / filename)
        atomic_json(stage / MARKER, {
            "package": "herdr-float-space", "version": "0.2.0",
            "files": {filename: digest(source / filename) for filename in FILES},
        })
        if destination.exists():
            destination.replace(previous)
        stage.replace(destination)
        replaced = True
        atomic_json(keys_path, keys)
    except Exception:
        if replaced and destination.exists():
            shutil.rmtree(destination)
        if previous.exists():
            previous.replace(destination)
        shutil.copy2(backup / "keys.json", keys_path)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if previous.exists():
            shutil.rmtree(previous)
    print(f"Installed. Backup: {backup}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
