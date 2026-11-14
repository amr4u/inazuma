"""Fail-closed local checks for the manually dispatched Firefox release."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

ADDON_ID = "decision-formfill@local.example"


def manifest_identity(root):
    manifest = json.loads((root / "dist-firefox-offline/manifest.json").read_text())
    version = json.loads((root / "package.json").read_text())["version"]
    if manifest["version"] != version or manifest["browser_specific_settings"]["gecko"]["id"] != ADDON_ID:
        raise ValueError("Manifest identity or version mismatch")
    return version


def validate_context(root, commit, tag, event_sha):
    head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or commit != head or commit != event_sha:
        raise ValueError("Target must be the full exact checked-out workflow commit SHA")
    version = json.loads((root / "package.json").read_text())["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or tag != f"v{version}":
        raise ValueError("Tag must exactly match the manifest/package version")
    for name in ["wxt.config.ts", "scripts/build-offline.cjs"]:
        text = (root / name).read_text()
        versions = re.findall(r"\bversion\s*:\s*['\"]([^'\"]+)['\"]", text)
        ids = re.findall(r"\bid\s*:\s*['\"]([^'\"]+)['\"]", text)
        if versions != [version] or ids != [ADDON_ID]:
            raise ValueError(f"Manifest identity/version mismatch in {name}")
    existing = subprocess.run(["git", "-C", str(root), "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"])
    if existing.returncode == 0:
        raise ValueError("Tag already exists; refusing to reuse or move it")
    if existing.returncode != 1:
        raise ValueError("Could not check existing tags")
    print(f"Validated new release {tag} at {commit} ({ADDON_ID})")


def prepare(root):
    version = manifest_identity(root)
    release = root / "release"
    if release.exists():
        raise ValueError("Release directory already exists; use a clean workspace")
    release.mkdir()
    # Positive allowlist: never archive arbitrary JSON, credentials, caches,
    # node_modules, .git, hidden files or a developer's untracked home files.
    exact = {"package.json", "package-lock.json", "README.md", "wxt.config.ts",
             "tsconfig.json", "tsconfig.test.json", "tsconfig.check-ui.json", ".gitignore",
             ".github/AMO_REVIEW.md", ".github/amo-metadata.json",
             ".github/RELEASE_NOTES.md", ".github/workflows/release.yml"}
    extensions = {"src": {".ts", ".css"}, "entrypoints": {".ts", ".html"},
                  "scripts": {".cjs", ".py"}, "tests": {".cjs", ".py"},
                  "fixtures": {".html"}, "docs": {".md"}}
    listed = subprocess.check_output(["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    names = sorted(set(listed.decode().rstrip("\0").split("\0")))
    locked = json.loads((root / "package-lock.json").read_text())["packages"]
    info = {
        "platform": platform.platform(), "architecture": platform.machine(),
        "os_release": platform.freedesktop_os_release(), "python": platform.python_version(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "npm": subprocess.check_output(["npm", "--version"], text=True).strip(),
        "tools": {name: locked[f"node_modules/{name}"]["version"] for name in ["typescript", "web-ext", "wxt"]},
        "build_command": "npm ci --ignore-scripts --no-audit --no-fund && npm run build:offline",
    }
    with zipfile.ZipFile(release / f"inazuma-v{version}-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("BUILD_INFO.json", json.dumps(info, indent=2) + "\n")
        for name in names:
            parts = Path(name).parts
            allowed = name in exact or (parts and Path(name).suffix in extensions.get(parts[0], set())
                                        and not any(part.startswith(".") for part in parts))
            if allowed:
                file = root / name
                if file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != root):
                    raise ValueError(f"Symlink not allowed in source: {name}")
                archive.write(file, name)
    built = root / "dist-firefox-offline"
    with zipfile.ZipFile(release / f"inazuma-v{version}-unpacked.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(built.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(built).as_posix())
    print(f"Prepared source-review and unpacked archives for v{version}")


def verify_signed(root, signed_dir):
    version = manifest_identity(root)
    candidates = list(signed_dir.glob("*.xpi"))
    if len(candidates) != 1:
        raise ValueError("Expected exactly one signed XPI")
    with zipfile.ZipFile(candidates[0]) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate XPI entries")
        required = {"META-INF/mozilla.rsa", "META-INF/mozilla.sf", "META-INF/manifest.mf"}
        if not required.issubset(names) or any(not archive.read(name) for name in required):
            raise ValueError("Missing signature markers")
        allowed_signature_entries = required | {"META-INF/cose.manifest", "META-INF/cose.sig", "META-INF/"}
        if any(name.startswith("META-INF/") and name not in allowed_signature_entries for name in names):
            raise ValueError("Unexpected signature entry")
        built = root / "dist-firefox-offline"
        expected = {p.relative_to(built).as_posix(): p.read_bytes() for p in built.rglob("*") if p.is_file()}
        payload = {name: archive.read(name) for name in names if not name.endswith("/") and not name.startswith("META-INF/")}
        if payload != expected:
            raise ValueError("Signed payload differs from tested build")
    release = root / "release"
    release.mkdir(exist_ok=True)
    destination = release / f"inazuma-v{version}-signed.xpi"
    shutil.copyfile(candidates[0], destination)
    assets = sorted(p for p in release.iterdir() if p.suffix in {".xpi", ".zip"})
    (release / "SHA256SUMS.txt").write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in assets
    ))
    print(f"Verified signature markers, exact tested payload and identity: {destination.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    context = sub.add_parser("context")
    context.add_argument("--commit", required=True)
    context.add_argument("--tag", required=True)
    sub.add_parser("prepare")
    verify = sub.add_parser("verify")
    verify.add_argument("--signed-dir", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if args.command == "context":
        import os
        validate_context(root, args.commit, args.tag, os.environ.get("GITHUB_SHA", ""))
    elif args.command == "prepare":
        prepare(root)
    elif args.command == "verify":
        verify_signed(root, args.signed_dir.resolve())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        print(f"Release refused: {error}", file=sys.stderr)
        sys.exit(1)
