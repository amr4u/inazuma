const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function pythonCheck(code) {
  const result = spawnSync('python3', ['-c', `
import importlib.util, pathlib, tempfile, json, zipfile, subprocess
spec = importlib.util.spec_from_file_location('release_helper', ${JSON.stringify(path.join(root, 'scripts/firefox-release.py'))})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='inazuma-safety-') as directory:
    root = pathlib.Path(directory)
${code.split('\n').map(line => '    ' + line).join('\n')}
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('release context binds full commit and fresh exact manifest-version tag', () => {
  pythonCheck(`
subprocess.run(['git', 'init', '-q', str(root)], check=True)
(root / 'package.json').write_text(json.dumps({'version':'0.1.0'}))
(root / 'wxt.config.ts').write_text("version:'0.1.0', id:'decision-formfill@local.example'")
(root / 'scripts').mkdir()
(root / 'scripts/build-offline.cjs').write_text("version:'0.1.0', id:'decision-formfill@local.example'")
subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
m.validate_context(root, sha, 'v0.1.0', sha)
for commit, tag, event_sha in [(sha[:8], 'v0.1.0', sha), ('0'*40, 'v0.1.0', sha), (sha, 'v0.1.0-alpha.1', sha), (sha, 'v0.1.0', '0'*40)]:
    try: m.validate_context(root, commit, tag, event_sha)
    except ValueError: pass
    else: raise AssertionError('unsafe context accepted')
subprocess.run(['git', '-C', str(root), 'tag', 'v0.1.0'], check=True)
try: m.validate_context(root, sha, 'v0.1.0', sha)
except ValueError as error: assert 'already exists' in str(error)
else: raise AssertionError('existing tag accepted')
`);
});

test('source archive includes rebuild inputs but excludes secrets, git and dependencies', () => {
  pythonCheck(`
subprocess.run(['git', 'init', '-q', str(root)], check=True)
files = {'package.json':'{"version":"0.1.0"}', 'package-lock.json':'{}', 'README.md':'review', 'wxt.config.ts':'', 'tsconfig.test.json':'{}', '.github/AMO_REVIEW.md':'npm ci; npm run build:offline', 'scripts/build-offline.cjs':'// source', 'entrypoints/background.ts':'// source', 'node_modules/fake.js':'secret', '.env':'secret', 'src/.env':'secret', 'src/credentials.json':'secret', '.git/config-secret':'secret'}
for name, content in files.items():
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
(root / 'package-lock.json').write_text(json.dumps({'packages':{'node_modules/typescript':{'version':'5.9.3'}, 'node_modules/web-ext':{'version':'10.5.0'}, 'node_modules/wxt':{'version':'0.21.5'}}}))
(root / 'dist-firefox-offline').mkdir()
(root / 'dist-firefox-offline/manifest.json').write_text(json.dumps({'version':'0.1.0','browser_specific_settings':{'gecko':{'id':m.ADDON_ID}}}))
m.prepare(root)
with zipfile.ZipFile(root / 'release/inazuma-v0.1.0-source.zip') as archive:
    names = set(archive.namelist())
    assert {'package-lock.json','scripts/build-offline.cjs','entrypoints/background.ts','.github/AMO_REVIEW.md'} <= names
    assert not any('secret' in name or '.env' in name or name.startswith(('node_modules/','.git/')) for name in names)
    assert 'src/credentials.json' not in names
    info = json.loads(archive.read('BUILD_INFO.json'))
    assert info['node'].startswith('v') and info['npm']
    assert info['platform'] and info['python']
    assert info['tools']['typescript'] == '5.9.3'
with zipfile.ZipFile(root / 'release/inazuma-v0.1.0-unpacked.zip') as archive:
    assert archive.namelist() == ['manifest.json']
`);
});

test('signed verifier fails closed for unsigned, wrong identity, tampering and ambiguous artifacts', () => {
  pythonCheck(`
(root / 'dist-firefox-offline').mkdir()
(root / 'signed-artifacts').mkdir()
(root / 'package.json').write_text('{"version":"0.1.0"}')
manifest = {'version':'0.1.0','browser_specific_settings':{'gecko':{'id':m.ADDON_ID}}}
payload = {'manifest.json':json.dumps(manifest).encode(),'background.js':b'original'}
for name, data in payload.items(): (root / 'dist-firefox-offline' / name).write_bytes(data)
markers = {'META-INF/'+name:b'FAKE TEST MARKER' for name in ['mozilla.rsa','mozilla.sf','manifest.mf']}
def reject(entries, message):
    xpi = root / 'signed-artifacts/result.xpi'
    with zipfile.ZipFile(xpi, 'w') as z:
        for name, data in entries.items(): z.writestr(name, data)
    try: m.verify_signed(root, root / 'signed-artifacts')
    except ValueError as error: assert message in str(error), str(error)
    else: raise AssertionError('unsafe artifact accepted')
    assert not (root / 'release/SHA256SUMS.txt').exists()
reject(payload, 'Missing signature')
reject({**payload, **markers, 'background.js':b'changed'}, 'differs')
reject({**payload, **markers, 'manifest.json':b'{"version":"9.9.9"}'}, 'differs')
reject({**payload, **markers, '../escape.js':b'bad'}, 'differs')
reject({**payload, **markers, 'META-INF/unexpected.js':b'bad'}, 'Unexpected signature entry')
with zipfile.ZipFile(root / 'signed-artifacts/extra.xpi','w') as z: pass
try: m.verify_signed(root, root / 'signed-artifacts')
except ValueError as error: assert 'exactly one' in str(error)
else: raise AssertionError('ambiguous artifacts accepted')
(root / 'signed-artifacts/extra.xpi').unlink()
manifest['browser_specific_settings']['gecko']['id'] = 'different@example.invalid'
(root / 'dist-firefox-offline/manifest.json').write_text(json.dumps(manifest))
try: m.verify_signed(root, root / 'signed-artifacts')
except ValueError as error: assert 'identity' in str(error)
else: raise AssertionError('different identity accepted')
`);
});
