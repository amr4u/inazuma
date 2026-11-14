"""Offline release fixtures only: never contacts GitHub or Mozilla."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
import hashlib
import os
import shutil
import sys
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("release_helper", Path(__file__).resolve().parents[1] / "scripts/firefox-release.py")
assert SPEC is not None and SPEC.loader is not None
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class PublishedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inazuma-published-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        for name, text in {
            "package.json": '{"version":"0.2.0"}',
            "package-lock.json": json.dumps({"packages": {"node_modules/" + tool: {"version": "1.0.0"} for tool in ["typescript", "web-ext", "wxt"]}}),
            "wxt.config.ts": "version:'0.2.0', id:'decision-formfill@local.example'",
            "scripts/build-offline.cjs": "version:'0.2.0', id:'decision-formfill@local.example'",
            "src/example.ts": "// tagged fixture source",
        }.items():
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(text)
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "tagged fixture")
        self.commit = self.git("rev-parse", "HEAD")
        self.git("tag", "-a", "v0.2.0", "-m", "fixture", config=True)
        self.release = {"id": 42, "tag_name": "v0.2.0", "draft": False, "published_at": "2026-01-01T00:00:00Z", "prerelease": False, "name": "Keep title", "body": "Keep notes", "target_commitish": "main"}
        self.event = {"action": "published", "repository": {"default_branch": "main"}, "release": self.release}

    def git(self, *args, config=False):
        identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"] if config else []
        return subprocess.check_output(["git", "-C", str(self.root), *identity, *args], text=True).strip()

    def test_only_published_release_or_default_branch_dispatch(self):
        for prerelease in [False, True]:
            event = copy.deepcopy(self.event)
            event["release"]["prerelease"] = prerelease
            self.assertEqual(m.validate_event("release", event, "refs/tags/v0.2.0"), "v0.2.0")
        dispatch = {"repository": {"default_branch": "main"}, "inputs": {"tag": "v0.2.0"}}
        self.assertEqual(m.validate_event("workflow_dispatch", dispatch, "refs/heads/main"), "v0.2.0")
        for action in ["edited", "created", "released", "prereleased"]:
            with self.assertRaises(ValueError):
                m.validate_event("release", {**self.event, "action": action}, "refs/tags/v0.2.0")
        for patch in [{"draft": True}, {"published_at": None}]:
            with self.assertRaises(ValueError):
                m.validate_event("release", {**self.event, "release": {**self.release, **patch}}, "refs/tags/v0.2.0")
        for name, event, ref in [("push", self.event, "refs/tags/v0.2.0"), ("workflow_dispatch", dispatch, "refs/heads/topic"), ("release", self.event, "refs/tags/v0.1.0")]:
            with self.assertRaises(ValueError):
                m.validate_event(name, event, ref)

    def build_fixture(self):
        built = self.root / "dist-firefox-offline"
        built.mkdir()
        (built / "manifest.json").write_text(json.dumps({"version": "0.2.0", "browser_specific_settings": {"gecko": {"id": m.ADDON_ID}}}))
        (built / "background.js").write_text("/* fixture payload */")
        return built

    def test_source_archive_is_only_exact_committed_source(self):
        self.build_fixture()
        (self.root / "src/untracked.ts").write_text("// must not reach AMO")
        m.prepare(self.root)
        with zipfile.ZipFile(self.root / "release/inazuma-v0.2.0-source.zip") as archive:
            self.assertNotIn("src/untracked.ts", archive.namelist())
            self.assertEqual(archive.read("src/example.ts"), b"// tagged fixture source")
            self.assertEqual(json.loads(archive.read("BUILD_INFO.json"))["commit"], self.commit)
        import shutil
        shutil.rmtree(self.root / "release")
        (self.root / "src/example.ts").write_text("// dirty tracked file")
        with self.assertRaises(ValueError):
            m.prepare(self.root)

    def signed_bundle(self):
        built = self.build_fixture()
        m.prepare(self.root)
        signed = self.root / "signed-artifacts"
        signed.mkdir()
        # Structural fixtures, NOT valid cryptographic signatures.
        with zipfile.ZipFile(signed / "fixture.xpi", "w") as archive:
            for file in built.iterdir():
                archive.write(file, file.name)
            for name in ["mozilla.rsa", "mozilla.sf", "manifest.mf"]:
                archive.writestr("META-INF/" + name, b"FAKE TEST MARKER")
        m.verify_signed(self.root, signed)
        return self.root / "release"

    def rehash(self, directory):
        (directory / "SHA256SUMS.txt").write_text("".join(
            f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n"
            for file in sorted(directory.iterdir()) if file.suffix in {".xpi", ".zip"}))

    def test_complete_assets_require_checksums_exact_manifest_payload_and_tagged_source(self):
        directory = self.signed_bundle()
        m.verify_bundle(self.root, self.commit, "v0.2.0", directory)
        sums = directory / "SHA256SUMS.txt"
        original = sums.read_text()
        sums.write_text(original.replace(original[:64], "0" * 64))
        with self.assertRaises(ValueError):
            m.verify_bundle(self.root, self.commit, "v0.2.0", directory)
        sums.write_text(original + original.splitlines()[0] + "\n")
        with self.assertRaises(ValueError):
            m.verify_bundle(self.root, self.commit, "v0.2.0", directory)
        sums.write_text(original)
        source = directory / "inazuma-v0.2.0-source.zip"
        with zipfile.ZipFile(source) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        with zipfile.ZipFile(source, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, b"// wrong source" if name == "src/example.ts" else data)
        self.rehash(directory)
        with self.assertRaises(ValueError):
            m.verify_bundle(self.root, self.commit, "v0.2.0", directory)
        with zipfile.ZipFile(source, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        for filename in ["inazuma-v0.2.0-unpacked.zip", "inazuma-v0.2.0-signed.xpi"]:
            file = directory / filename
            with zipfile.ZipFile(file) as archive:
                contents = {name: archive.read(name) for name in archive.namelist()}
            manifest = json.loads(contents["manifest.json"])
            manifest["browser_specific_settings"]["gecko"]["id"] = "wrong@example.invalid"
            contents["manifest.json"] = json.dumps(manifest).encode()
            with zipfile.ZipFile(file, "w") as archive:
                for name, data in contents.items():
                    archive.writestr(name, data)
        self.rehash(directory)
        with self.assertRaises(ValueError):
            m.verify_bundle(self.root, self.commit, "v0.2.0", directory)

    def fake_github(self, bundle=None):
        remote = self.root / ".fake-github"
        (remote / "bin").mkdir(parents=True)
        (remote / "assets").mkdir()
        (remote / "release.json").write_text(json.dumps(self.release))
        (remote / "tag-ref.json").write_text(json.dumps({"object": {"type": "commit", "sha": self.commit}}))
        assets = []
        if bundle:
            for index, file in enumerate(sorted(bundle.iterdir()), 100):
                shutil.copyfile(file, remote / "assets" / str(index))
                assets.append({"id": index, "name": file.name, "size": file.stat().st_size, "state": "uploaded"})
        (remote / "assets.json").write_text(json.dumps(assets))
        executable = remote / "bin/gh"
        executable.write_text(f"#!{sys.executable}\n" + '''import json, pathlib, shutil, sys
from urllib.parse import urlparse, parse_qs
root = pathlib.Path(__file__).resolve().parents[1]
args = sys.argv[1:]
with (root / 'calls.jsonl').open('a') as log: log.write(json.dumps(args) + '\\n')
assert args[0] == 'api', args
endpoint = args[1]
assets = json.loads((root / 'assets.json').read_text())
if endpoint == 'repos/owner/inazuma/git/ref/tags/v0.2.0':
    print((root / 'tag-ref.json').read_text())
elif endpoint in ['repos/owner/inazuma/releases/tags/v0.2.0', 'repos/owner/inazuma/releases/42']:
    assert '--method' not in args
    print((root / 'release.json').read_text())
elif endpoint == 'repos/owner/inazuma/releases/42/assets':
    assert '--paginate' in args and '--slurp' in args
    print(json.dumps([assets[i:i+2] for i in range(0, len(assets), 2)]))
elif endpoint.startswith('repos/owner/inazuma/releases/assets/'):
    assert 'Accept: application/octet-stream' in args
    sys.stdout.buffer.write((root / 'assets' / endpoint.rsplit('/', 1)[1]).read_bytes())
elif endpoint.startswith('https://uploads.github.com/repos/owner/inazuma/releases/42/assets?'):
    assert args[args.index('--method') + 1] == 'POST'
    name = parse_qs(urlparse(endpoint).query)['name'][0]
    assert not any(asset['name'] == name for asset in assets), 'duplicate upload refused'
    file = pathlib.Path(args[args.index('--input') + 1])
    asset = {'id': 100 + len(assets), 'name': name, 'size': file.stat().st_size, 'state': 'uploaded'}
    shutil.copyfile(file, root / 'assets' / str(asset['id']))
    assets.append(asset)
    (root / 'assets.json').write_text(json.dumps(assets))
    print(json.dumps(asset))
else:
    raise AssertionError('Unexpected API call: ' + repr(args))
''')
        executable.chmod(0o755)
        event_file = remote / "event.json"
        event_file.write_text(json.dumps(self.event))
        environment = {
            "PATH": str(remote / "bin") + os.pathsep + os.environ["PATH"],
            "GITHUB_EVENT_NAME": "release", "GITHUB_EVENT_PATH": str(event_file),
            "GITHUB_REF": "refs/tags/v0.2.0", "GITHUB_SHA": self.commit,
            "GITHUB_REPOSITORY": "owner/inazuma", "GITHUB_OUTPUT": str(remote / "output"),
            "GH_TOKEN": "",  # No real credentials, ever.
        }
        return remote, environment

    def test_preflight_complete_old_tag_skips_without_source_checkout_or_writes(self):
        bundle = self.signed_bundle()
        # Legacy BUILD_INFO had no commit field; exact source comparison still binds it.
        source = bundle / "inazuma-v0.2.0-source.zip"
        with zipfile.ZipFile(source) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        info = json.loads(entries["BUILD_INFO.json"])
        info.pop("commit")
        entries["BUILD_INFO.json"] = json.dumps(info).encode()
        with zipfile.ZipFile(source, "w") as archive:
            for name, data in entries.items(): archive.writestr(name, data)
        self.rehash(bundle)
        remote, env = self.fake_github(bundle)
        (self.root / "src/example.ts").write_text("// different default branch")
        self.git("add", "src/example.ts")
        self.git("commit", "-qm", "newer automation fixture", config=True)
        with patch.dict(os.environ, env):
            m.preflight(self.root, remote / "state.json", remote / "downloads")
        state = json.loads((remote / "state.json").read_text())
        self.assertFalse(state["needs_signing"])
        self.assertEqual(state["commit"], self.commit)
        self.assertIn("needs_signing=false", (remote / "output").read_text())
        calls = [json.loads(line) for line in (remote / "calls.jsonl").read_text().splitlines()]
        self.assertTrue(all('--method' not in call for call in calls))
        dispatch = {"repository": {"default_branch": "main"}, "inputs": {"tag": "v0.2.0"}}
        (remote / "event.json").write_text(json.dumps(dispatch))
        with patch.dict(os.environ, {**env, "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": self.git("rev-parse", "HEAD")}):
            m.preflight(self.root, remote / "retry-state.json", remote / "retry-downloads")
        self.assertFalse(json.loads((remote / "retry-state.json").read_text())["needs_signing"])

    def test_preflight_empty_can_sign_but_partial_conflicting_or_wrong_event_sha_refused(self):
        remote, env = self.fake_github()
        with patch.dict(os.environ, env):
            m.preflight(self.root, remote / "state.json", remote / "downloads")
        self.assertTrue(json.loads((remote / "state.json").read_text())["needs_signing"])
        for assets in [[{"id": 1, "name": "inazuma-v0.2.0-signed.xpi"}], [{"id": 2, "name": "unrelated.zip"}]]:
            (remote / "assets.json").write_text(json.dumps(assets))
            with patch.dict(os.environ, env), self.assertRaises(ValueError):
                m.preflight(self.root, remote / "bad-state.json", remote / "bad-downloads")
            self.assertFalse((remote / "bad-state.json").exists())
        (remote / "assets.json").write_text("[]")
        with patch.dict(os.environ, {**env, "GITHUB_SHA": "0" * 40}), self.assertRaises(ValueError):
            m.preflight(self.root, remote / "bad-state.json", remote / "bad-downloads")
        for change in [{"draft": True}, {"published_at": None}, {"id": 999}]:
            (remote / "release.json").write_text(json.dumps({**self.release, **change}))
            with patch.dict(os.environ, env), self.assertRaises(ValueError):
                m.preflight(self.root, remote / "bad-state.json", remote / "bad-downloads")

    def cli(self, command, env, remote, downloads):
        return subprocess.run([sys.executable, str(SPEC.origin), command, "--state", str(remote / "state.json"), "--downloads", str(remote / downloads)], cwd=self.root, env={**os.environ, **env}, text=True, capture_output=True)

    def test_cli_uploads_only_four_assets_to_original_release_id_and_reads_back(self):
        bundle = self.signed_bundle()
        remote, env = self.fake_github()
        before = (remote / "release.json").read_bytes()
        result = self.cli("preflight", env, remote, "initial-downloads")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = self.cli("upload", env, remote, "readback")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(before, (remote / "release.json").read_bytes())
        self.assertEqual(len(json.loads((remote / "assets.json").read_text())), 4)
        for file in bundle.iterdir():
            self.assertEqual(file.read_bytes(), (remote / "readback" / file.name).read_bytes())
        calls = [json.loads(line) for line in (remote / "calls.jsonl").read_text().splitlines()]
        writes = [call for call in calls if '--method' in call]
        self.assertEqual(len(writes), 4)
        self.assertTrue(all(call[call.index('--method') + 1] == 'POST' and '/releases/42/assets?' in call[1] for call in writes))
        result = self.cli("preflight", env, remote, "complete-downloads")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(json.loads((remote / "state.json").read_text())["needs_signing"])

    def test_upload_refuses_metadata_drift_partial_assets_and_changed_tag_before_write(self):
        self.signed_bundle()
        remote, env = self.fake_github()
        with patch.dict(os.environ, env):
            m.preflight(self.root, remote / "state.json", remote / "downloads")
            (remote / "release.json").write_text(json.dumps({**self.release, "body": "edited in meantime"}))
            with self.assertRaises(ValueError):
                m.upload(self.root, remote / "state.json", remote / "readback")
            (remote / "release.json").write_text(json.dumps(self.release))
            (remote / "assets.json").write_text(json.dumps([{"id": 9, "name": "inazuma-v0.2.0-source.zip"}]))
            with self.assertRaises(ValueError):
                m.upload(self.root, remote / "state.json", remote / "readback")
            (remote / "assets.json").write_text("[]")
            self.git("tag", "-f", "v0.2.0", "HEAD~0")
            # Full SHA mismatch in saved state must be rejected, not repaired.
            state = json.loads((remote / "state.json").read_text())
            state["commit"] = "0" * 40
            (remote / "state.json").write_text(json.dumps(state))
            with self.assertRaises(ValueError):
                m.upload(self.root, remote / "state.json", remote / "readback")
        calls = [json.loads(line) for line in (remote / "calls.jsonl").read_text().splitlines()]
        self.assertTrue(all('--method' not in call for call in calls))

    def test_remote_only_tag_movement_refuses_upload_before_any_write(self):
        self.signed_bundle()
        remote, env = self.fake_github()
        with patch.dict(os.environ, env):
            m.preflight(self.root, remote / "state.json", remote / "downloads")
            (remote / "tag-ref.json").write_text(json.dumps({"object": {"type": "commit", "sha": "0" * 40}}))
            self.assertEqual(m.tag_commit(self.root, "v0.2.0"), self.commit)
            with self.assertRaisesRegex(ValueError, "Remote tag"):
                m.upload(self.root, remote / "state.json", remote / "readback")
        calls = [json.loads(line) for line in (remote / "calls.jsonl").read_text().splitlines()]
        self.assertTrue(all('--method' not in call for call in calls))

    def test_remote_annotated_tags_are_peeled_and_cycles_refused(self):
        annotated = {"object": {"type": "tag", "sha": "b" * 40}}
        with patch.object(m, "gh_json", side_effect=[annotated, {"object": {"type": "commit", "sha": self.commit}}]):
            self.assertEqual(m.remote_tag_commit("owner/inazuma", "v0.2.0"), self.commit)
        with patch.object(m, "gh_json", return_value=annotated), self.assertRaisesRegex(ValueError, "cyclic"):
            m.remote_tag_commit("owner/inazuma", "v0.2.0")

    def test_existing_annotated_tag_resolves_exact_commit_not_default_head(self):
        self.assertEqual(m.tag_commit(self.root, "v0.2.0"), self.commit)
        m.validate_context(self.root, self.commit, "v0.2.0")
        (self.root / "src/example.ts").write_text("// later default branch")
        self.git("add", ".")
        self.git("commit", "-qm", "later fixture", config=True)
        self.assertEqual(m.tag_commit(self.root, "v0.2.0"), self.commit)
        with self.assertRaises(ValueError):
            m.validate_context(self.root, self.commit, "v0.2.0")
        with self.assertRaises(ValueError):
            m.tag_identity(self.root, self.commit, "v0.3.0")
        self.git("checkout", "-q", self.commit)
        (self.root / "wxt.config.ts").write_text("version:'9.9.9', id:'decision-formfill@local.example'")
        with self.assertRaises(ValueError):
            m.validate_context(self.root, self.commit, "v0.2.0")


if __name__ == "__main__":
    unittest.main()
