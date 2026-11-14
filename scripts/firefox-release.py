"""Fail-closed signing and asset checks for an existing published Firefox release."""
import argparse
import hashlib
import json
import os
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


def valid_tag(tag):
    if not isinstance(tag, str) or not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("Tag must exactly match the numeric manifest/package version")
    return tag


def validate_event(name, event, ref):
    if name == "release":
        release = event["release"]
        tag = valid_tag(release["tag_name"])
        if (event.get("action") != "published" or release.get("draft") is not False
                or not release.get("published_at") or ref != f"refs/tags/{tag}"):
            raise ValueError("Only a published release event is allowed")
    elif name == "workflow_dispatch":
        if ref != f"refs/heads/{event['repository']['default_branch']}":
            raise ValueError("Manual retries must run from the default branch")
        tag = valid_tag(event["inputs"]["tag"])
    else:
        raise ValueError("Only published release events or manual retries are allowed")
    return tag


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def tag_commit(root, tag):
    valid_tag(tag)
    try:
        return git(root, "rev-parse", "--verify", "--quiet", f"refs/tags/{tag}^{{commit}}").decode().strip()
    except subprocess.CalledProcessError as error:
        raise ValueError("Release tag must already exist and resolve to a commit") from error


def check_identity(read, tag):
    version = json.loads(read("package.json"))["version"]
    if valid_tag(tag) != f"v{version}":
        raise ValueError("Tag must exactly match the manifest/package version")
    for name in ["wxt.config.ts", "scripts/build-offline.cjs"]:
        text = read(name)
        versions = re.findall(r"\bversion\s*:\s*['\"]([^'\"]+)['\"]", text)
        ids = re.findall(r"\bid\s*:\s*['\"]([^'\"]+)['\"]", text)
        if versions != [version] or ids != [ADDON_ID]:
            raise ValueError(f"Manifest identity/version mismatch in {name}")
    return version


def tag_identity(root, commit, tag):
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or tag_commit(root, tag) != commit:
        raise ValueError("Target must be the full exact release tag commit SHA")
    return check_identity(lambda name: git(root, "show", f"{commit}:{name}").decode(), tag)


def validate_context(root, commit, tag):
    if git(root, "rev-parse", "HEAD").decode().strip() != commit:
        raise ValueError("Target must be the full exact checked-out release tag commit SHA")
    version = tag_identity(root, commit, tag)
    check_identity(lambda name: (root / name).read_text(), tag)
    if git(root, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Release source checkout has tracked modifications")
    print(f"Validated existing release {tag} at {commit} ({ADDON_ID})")
    return version


def source_files(root, commit):
    # Positive allowlist, read from Git objects rather than either worktree.
    # Never archive credentials, dependencies, untracked or automation files.
    exact = {"package.json", "package-lock.json", "README.md", "wxt.config.ts",
             "tsconfig.json", "tsconfig.test.json", "tsconfig.check-ui.json", ".gitignore",
             ".github/AMO_REVIEW.md", ".github/amo-metadata.json",
             ".github/RELEASE_NOTES.md", ".github/workflows/release.yml"}
    extensions = {"src": {".ts", ".css"}, "entrypoints": {".ts", ".html"},
                  "scripts": {".cjs", ".py"}, "tests": {".cjs", ".py"},
                  "fixtures": {".html"}, "docs": {".md"}}
    files = {}
    for entry in git(root, "ls-tree", "-rz", commit).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        name = raw_name.decode()
        parts = Path(name).parts
        allowed = name in exact or (parts and Path(name).suffix in extensions.get(parts[0], set())
                                    and not any(part.startswith(".") for part in parts))
        if allowed:
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise ValueError(f"Non-regular source file: {name}")
            files[name] = git(root, "cat-file", "blob", oid)
    return files


def prepare(root):
    version = manifest_identity(root)
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    validate_context(root, commit, f"v{version}")
    files = source_files(root, commit)
    release = root / "release"
    if release.exists():
        raise ValueError("Release directory already exists; use a clean workspace")
    release.mkdir()
    locked = json.loads(files["package-lock.json"])["packages"]
    info = {
        "commit": commit,
        "platform": platform.platform(), "architecture": platform.machine(),
        "os_release": platform.freedesktop_os_release(), "python": platform.python_version(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "npm": subprocess.check_output(["npm", "--version"], text=True).strip(),
        "tools": {name: locked[f"node_modules/{name}"]["version"] for name in ["typescript", "web-ext", "wxt"]},
        "build_command": "npm ci --ignore-scripts --no-audit --no-fund && npm run build:offline",
    }
    with zipfile.ZipFile(release / f"inazuma-v{version}-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("BUILD_INFO.json", json.dumps(info, indent=2) + "\n")
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
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


def asset_names(tag):
    valid_tag(tag)
    return {f"inazuma-{tag}-signed.xpi", f"inazuma-{tag}-source.zip",
            f"inazuma-{tag}-unpacked.zip", "SHA256SUMS.txt"}


def zip_entries(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive entries")
        if any(name.startswith("/") or "\\" in name or ".." in Path(name).parts for name in names):
            raise ValueError("Unsafe archive path")
        return {name: archive.read(name) for name in names if not name.endswith("/")}


def verify_bundle(root, commit, tag, directory):
    version = tag_identity(root, commit, tag)
    expected = asset_names(tag)
    if {file.name for file in directory.iterdir()} != expected:
        raise ValueError("Partial or conflicting release assets; refusing to sign or overwrite")
    checksums = {}
    for line in (directory / "SHA256SUMS.txt").read_text().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([^/\\]+)", line)
        if not match or match[2] in checksums:
            raise ValueError("Invalid or duplicate checksum entry")
        checksums[match[2]] = match[1]
    if set(checksums) != expected - {"SHA256SUMS.txt"}:
        raise ValueError("Checksum asset list mismatch")
    for name, digest in checksums.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Checksum mismatch: {name}")
    unpacked = zip_entries(directory / f"inazuma-{tag}-unpacked.zip")
    signed = zip_entries(directory / f"inazuma-{tag}-signed.xpi")
    required = {"META-INF/mozilla.rsa", "META-INF/mozilla.sf", "META-INF/manifest.mf"}
    allowed = required | {"META-INF/cose.manifest", "META-INF/cose.sig"}
    if not required <= signed.keys() or any(not signed[name] for name in required):
        raise ValueError("Missing signature markers")
    if any(name.startswith("META-INF/") and name not in allowed for name in signed):
        raise ValueError("Unexpected signature entry")
    payload = {name: data for name, data in signed.items() if not name.startswith("META-INF/")}
    if payload != unpacked:
        raise ValueError("Signed payload differs from unpacked archive")
    manifest = json.loads(payload["manifest.json"])
    if manifest["version"] != version or manifest["browser_specific_settings"]["gecko"]["id"] != ADDON_ID:
        raise ValueError("Downloaded manifest identity/version mismatch")
    source = zip_entries(directory / f"inazuma-{tag}-source.zip")
    info = json.loads(source.pop("BUILD_INFO.json"))
    if source != source_files(root, commit):
        raise ValueError("Source archive differs from exact tagged source")
    # Old published bundles predate the commit field; their source bytes still
    # have to match the tag exactly. Never require their old helper to execute.
    if info.get("commit", commit) != commit:
        raise ValueError("Source build commit mismatch")
    if not all(info.get(key) for key in ["platform", "architecture", "os_release", "python", "node", "npm", "build_command"]):
        raise ValueError("Missing source build information")
    locked = json.loads(source["package-lock.json"])["packages"]
    if info["tools"] != {name: locked[f"node_modules/{name}"]["version"] for name in ["typescript", "web-ext", "wxt"]}:
        raise ValueError("Build tool versions differ from source lockfile")
    print(f"Verified complete assets for {tag}; checksums, manifest, payload and exact source match")


def gh_json(endpoint, *options):
    return json.loads(subprocess.check_output(["gh", "api", endpoint, *options]))


def remote_tag_commit(repo, tag):
    valid_tag(tag)
    obj = gh_json(f"repos/{repo}/git/ref/tags/{tag}")["object"]
    seen = set()
    for _ in range(10):
        sha, kind = obj.get("sha"), obj.get("type")
        if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha) or sha in seen:
            raise ValueError("Remote tag has an invalid or cyclic object")
        seen.add(sha)
        if kind == "commit":
            return sha
        if kind != "tag":
            raise ValueError("Remote tag does not resolve to a commit")
        obj = gh_json(f"repos/{repo}/git/tags/{sha}")["object"]
    raise ValueError("Remote tag nesting is too deep")


def repository():
    repo = os.environ["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid repository")
    return repo


def release_metadata(release, tag):
    if (release["tag_name"] != tag or release.get("draft") is not False
            or not release.get("published_at") or type(release["id"]) is not int or release["id"] <= 0):
        raise ValueError("Expected the same existing published release")
    return {key: release.get(key) for key in ["id", "tag_name", "name", "body", "draft", "prerelease", "published_at", "target_commitish"]}


def release_assets(repo, release_id):
    pages = gh_json(f"repos/{repo}/releases/{release_id}/assets", "--paginate", "--slurp")
    return [asset for page in pages for asset in page]


def download_assets(repo, tag, assets, directory):
    if len(assets) != 4 or {asset["name"] for asset in assets} != asset_names(tag):
        raise ValueError("Partial or conflicting release assets; refusing to sign or overwrite")
    if (len({asset['id'] for asset in assets}) != 4
            or any(type(asset["id"]) is not int or asset["id"] <= 0 or asset.get("state") != "uploaded" for asset in assets)):
        raise ValueError("Invalid release asset metadata")
    directory.mkdir()
    for asset in assets:
        with (directory / asset["name"]).open("xb") as output:
            subprocess.run(["gh", "api", f"repos/{repo}/releases/assets/{asset['id']}",
                            "-H", "Accept: application/octet-stream"], stdout=output, check=True)
        if (directory / asset["name"]).stat().st_size != asset["size"]:
            raise ValueError("Downloaded asset size mismatch")


def preflight(root, state_path, downloads):
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    name = os.environ["GITHUB_EVENT_NAME"]
    tag = validate_event(name, event, os.environ["GITHUB_REF"])
    commit = tag_commit(root, tag)
    version = tag_identity(root, commit, tag)
    if name == "release" and os.environ["GITHUB_SHA"] != commit:
        raise ValueError("Release event SHA differs from exact tag commit")
    repo = repository()
    release = gh_json(f"repos/{repo}/releases/tags/{tag}")
    metadata = release_metadata(release, tag)
    if name == "release" and release["id"] != event["release"]["id"]:
        raise ValueError("Release ID differs from published event")
    assets = release_assets(repo, release["id"])
    if assets:
        download_assets(repo, tag, assets, downloads)
        verify_bundle(root, commit, tag, downloads)
    state = {"repository": repo, "tag": tag, "commit": commit, "version": version,
             "release_id": release["id"], "metadata": metadata, "needs_signing": not bool(assets)}
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key in ["tag", "commit", "version", "release_id", "needs_signing"]:
            value = str(state[key]).lower() if isinstance(state[key], bool) else str(state[key])
            output.write(f"{key}={value}\n")
    print("Verified complete existing release; skipping signing and all uploads" if assets else "Published release has no assets; exact tag is ready for signing")


def upload(root, state_path, downloads):
    state = json.loads(state_path.read_text())
    repo, tag, commit = state["repository"], state["tag"], state["commit"]
    if repo != repository() or state["needs_signing"] is not True:
        raise ValueError("Upload requires this repository's empty-release preflight")
    validate_context(root, commit, tag)
    directory = root / "release"
    verify_bundle(root, commit, tag, directory)
    endpoint = f"repos/{repo}/releases/{state['release_id']}"
    if release_metadata(gh_json(endpoint), tag) != state["metadata"]:
        raise ValueError("Published release metadata changed; refusing upload")
    if release_assets(repo, state["release_id"]):
        raise ValueError("Release assets appeared after preflight; refusing to overwrite")
    if remote_tag_commit(repo, tag) != commit:
        raise ValueError("Remote tag changed after preflight; refusing upload")
    # Upload by immutable release ID, not by creating/resolving another release.
    # The GitHub API refuses duplicate names; never delete or clobber assets.
    for name in sorted(asset_names(tag)):
        subprocess.run(["gh", "api", f"https://uploads.github.com/{endpoint}/assets?name={name}",
                        "--method", "POST", "-H", "Content-Type: application/octet-stream",
                        "--input", str(directory / name)], check=True, stdout=subprocess.DEVNULL)
    if release_metadata(gh_json(endpoint), tag) != state["metadata"]:
        raise ValueError("Release metadata changed during upload")
    if remote_tag_commit(repo, tag) != commit:
        raise ValueError("Remote tag changed during upload")
    download_assets(repo, tag, release_assets(repo, state["release_id"]), downloads)
    verify_bundle(root, commit, tag, downloads)
    if any((downloads / name).read_bytes() != (directory / name).read_bytes() for name in asset_names(tag)):
        raise ValueError("Uploaded asset bytes differ from verified local assets")
    print(f"Uploaded and read back verified assets on existing release {state['release_id']} ({tag}); metadata unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    context = sub.add_parser("context")
    context.add_argument("--commit", required=True)
    context.add_argument("--tag", required=True)
    sub.add_parser("prepare")
    verify = sub.add_parser("verify")
    verify.add_argument("--signed-dir", type=Path, required=True)
    for command in ["preflight", "upload"]:
        release = sub.add_parser(command)
        release.add_argument("--state", type=Path, required=True)
        release.add_argument("--downloads", type=Path, required=True)
    args = parser.parse_args()
    # The helper lives in the trusted automation checkout; source operations
    # deliberately use the caller's exact-tag working directory instead.
    root = Path.cwd().resolve()
    if args.command == "context":
        validate_context(root, args.commit, args.tag)
    elif args.command == "preflight":
        preflight(root, args.state.resolve(), args.downloads.resolve())
    elif args.command == "upload":
        upload(root, args.state.resolve(), args.downloads.resolve())
    elif args.command == "prepare":
        prepare(root)
    elif args.command == "verify":
        verify_signed(root, args.signed_dir.resolve())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Release refused: {error}", file=sys.stderr)
        sys.exit(1)
