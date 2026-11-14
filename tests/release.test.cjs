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

test('published stable/prereleases and explicit existing-release retry are the only triggers', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['release', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.release.types, ['published']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ['tag']);
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.match(workflow.jobs.release.if, /github.event_name == 'release'/);
  assert.match(workflow.jobs.release.if, /github.event.repository.default_branch/);
  assert.doesNotMatch(workflowText, /--clobber|gh release create|git\/refs|target_commit/);
});

test('trusted helper preflights old releases before exact source commit checkout', () => {
  const checkouts = steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 2);
  assert.equal(checkouts[0].with.path, 'automation');
  assert.equal(checkouts[0].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(checkouts[0].with['fetch-depth'], 0);
  assert.equal(checkouts[1].with.path, 'source');
  assert.equal(checkouts[1].with.ref, '${{ steps.preflight.outputs.commit }}');
  const preflight = steps.findIndex(step => step.id === 'preflight');
  assert.ok(preflight > steps.indexOf(checkouts[0]) && preflight < steps.indexOf(checkouts[1]));
  for (const step of steps.slice(preflight + 1)) {
    assert.equal(step.if, "steps.preflight.outputs.needs_signing == 'true'");
  }
  for (const step of checkouts) assert.equal(step.with['persist-credentials'], false);
});

test('web-ext signs an isolated copy and uploads dynamic matching reviewer source', () => {
  assert.equal(sign['working-directory'], 'source');
  assert.match(sign.run, /cp -R dist-firefox-offline signing-input/);
  assert.match(sign.run, /--source-dir signing-input/);
  assert.match(sign.run, /--upload-source-code "release\/inazuma-v\$VERSION-source.zip"/);
  assert.match(sign.run, /--amo-metadata \.github\/amo-metadata\.json/);
});

test('AMO secrets are step-local environment variables, never command arguments or echoes', () => {
  assert.deepEqual(sign.env, {
    WEB_EXT_API_KEY: '${{ secrets.FIREFOX_AMO_API_KEY }}',
    WEB_EXT_API_SECRET: '${{ secrets.FIREFOX_AMO_API_SECRET }}',
  });
  assert.doesNotMatch(JSON.stringify(workflow.env || {}), /FIREFOX_AMO_API/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs.release.env || {}), /FIREFOX_AMO_API/);
  for (const step of steps.filter(step => step !== sign)) {
    assert.doesNotMatch(JSON.stringify(step), /secrets\.FIREFOX_AMO_API/);
  }
  assert.doesNotMatch(sign.run, /--api-(key|secret)|set -x|echo[^\n]*\$.*WEB_EXT/);
  assert.match(sign.run, /--channel unlisted/);
});

test('reviewer metadata and instructions do not pin future submissions to 0.1.0', () => {
  const metadata = fs.readFileSync(path.join(root, '.github/amo-metadata.json'), 'utf8');
  const review = fs.readFileSync(path.join(root, '.github/AMO_REVIEW.md'), 'utf8');
  assert.doesNotMatch(metadata, /manifest version is 0\.1\.0/);
  assert.doesNotMatch(review, /corresponds to Decision Formfill `0\.1\.0`/);
});

test('actual signing shell fails before running web-ext when credentials are absent', () => {
  const result = spawnSync('bash', ['-c', sign.run], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, WEB_EXT_API_KEY: '', WEB_EXT_API_SECRET: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing FIREFOX_AMO_API_KEY or FIREFOX_AMO_API_SECRET/);
});

test('only verified outputs reach an existing release using the trusted uploader', () => {
  const verifyIndex = steps.findIndex(step => step.run?.includes('firefox-release.py verify'));
  const uploadIndex = steps.findIndex(step => step.run?.includes('firefox-release.py upload'));
  assert.ok(verifyIndex > steps.indexOf(sign) && uploadIndex > verifyIndex);
  assert.match(steps[uploadIndex].run, /\.\.\/automation\/scripts\/firefox-release.py upload/);
  for (const step of steps) assert.notEqual(step['continue-on-error'], true);
});
