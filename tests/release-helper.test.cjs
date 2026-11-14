const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

// Exercise the actual Python ZIP verifier using deterministic, explicitly fake
// signature markers. No signing API or cryptographic authenticity is simulated.
test('signed release verifier accepts matching payload and writes checksums', () => {
  const scratch = process.env.TMPDIR || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(scratch, 'inazuma-release-test-'));
  try {
    const fixture = spawnSync('python3', ['-c', `
import importlib.util, json, pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
(root / 'dist-firefox-offline').mkdir()
(root / 'signed-artifacts').mkdir()
(root / 'release').mkdir()
manifest = {'manifest_version': 2, 'version': '0.1.0', 'browser_specific_settings': {'gecko': {'id': 'decision-formfill@local.example'}}}
(root / 'package.json').write_text(json.dumps({'version': '0.1.0'}))
(root / 'dist-firefox-offline/manifest.json').write_text(json.dumps(manifest))
(root / 'dist-firefox-offline/background.js').write_text('/* fixture */')
with zipfile.ZipFile(root / 'signed-artifacts/result.xpi', 'w') as z:
    for p in (root / 'dist-firefox-offline').iterdir(): z.write(p, p.name)
    for name in ['mozilla.rsa', 'mozilla.sf', 'manifest.mf']: z.writestr('META-INF/' + name, b'FAKE TEST MARKER')
spec = importlib.util.spec_from_file_location('release_helper', sys.argv[2])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.verify_signed(root, root / 'signed-artifacts')
`, dir, path.join(root, 'scripts/firefox-release.py')], { encoding: 'utf8' });
    assert.equal(fixture.status, 0, fixture.stderr);
    const sums = fs.readFileSync(path.join(dir, 'release/SHA256SUMS.txt'), 'utf8');
    assert.match(sums, /^[a-f0-9]{64}  inazuma-v0\.1\.0-signed\.xpi\n$/);
    const signed = fs.readFileSync(path.join(dir, 'release/inazuma-v0.1.0-signed.xpi'));
    const digest = require('node:crypto').createHash('sha256').update(signed).digest('hex');
    assert.equal(sums, `${digest}  inazuma-v0.1.0-signed.xpi\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
