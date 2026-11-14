const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const workflowText = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
const workflow = yaml.load(workflowText);
const steps = workflow.jobs.release.steps;
const sign = steps.find(step => step.name === 'Sign unlisted with Mozilla');

test('release signing is manual only, with explicit target and fresh version tag', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.target_commit.required, true);
  assert.equal(inputs.tag.required, true);
  assert.equal(inputs.tag.default, 'v0.1.0');
  assert.equal(workflow.jobs.release.if, "github.ref == 'refs/heads/main'");
  assert.doesNotMatch(workflowText, /--clobber/);
});

test('web-ext signs an isolated copy so its upload bookkeeping cannot change tested payload', () => {
  assert.match(sign.run, /cp -R dist-firefox-offline signing-input/);
  assert.match(sign.run, /--source-dir signing-input/);
});

test('AMO secrets are step-local environment variables, never command arguments or echoes', () => {
  assert.deepEqual(sign.env, {
    WEB_EXT_API_KEY: '${{ secrets.FIREFOX_AMO_API_KEY }}',
    WEB_EXT_API_SECRET: '${{ secrets.FIREFOX_AMO_API_SECRET }}',
  });
  for (const step of steps.filter(step => step !== sign)) {
    assert.doesNotMatch(JSON.stringify(step), /secrets\.FIREFOX_AMO_API/);
  }
  assert.doesNotMatch(sign.run, /--api-(key|secret)|set -x|echo[^\n]*\$.*WEB_EXT/);
  assert.match(sign.run, /--channel unlisted/);
  assert.match(sign.run, /--upload-source-code release\/inazuma-v0\.1\.0-source\.zip/);
  assert.match(sign.run, /--amo-metadata \.github\/amo-metadata\.json/);
});

test('actual signing shell fails before running web-ext when credentials are absent', () => {
  const result = spawnSync('bash', ['-c', sign.run], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, WEB_EXT_API_KEY: '', WEB_EXT_API_SECRET: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing FIREFOX_AMO_API_KEY or FIREFOX_AMO_API_SECRET/);
});

test('only verified signed outputs can reach a new non-latest prerelease', () => {
  const verifyIndex = steps.findIndex(step => step.run?.includes('firefox-release.py verify'));
  const publishIndex = steps.findIndex(step => step.run?.includes('gh release create'));
  assert.ok(verifyIndex > steps.indexOf(sign) && publishIndex > verifyIndex);
  for (const step of steps) {
    assert.notEqual(step['continue-on-error'], true);
    assert.equal(step.if, undefined);
  }
  assert.match(steps[publishIndex].run, /--target "\$TARGET_COMMIT"/);
  assert.match(steps[publishIndex].run, /gh api --method POST .*\/git\/refs/);
  assert.match(steps[publishIndex].run, /-f ref="refs\/tags\/\$RELEASE_TAG" -f sha="\$TARGET_COMMIT"/);
  assert.match(steps[publishIndex].run, /--verify-tag/);
  assert.match(steps[publishIndex].run, /--prerelease --latest=false/);
  assert.match(steps[publishIndex].run, /gh release view/);
});
