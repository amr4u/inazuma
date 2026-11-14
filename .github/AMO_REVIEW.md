# Mozilla source review / reproducible prototype build

This source archive corresponds to the Decision Formfill version in its
`package.json` and the matching release tag, ID `decision-formfill@local.example`. It contains TypeScript and the small custom
CommonJS bundler in `scripts/build-offline.cjs`. The code is not obfuscated and no
third-party runtime JavaScript is bundled. This signing pipeline intentionally
uses the existing offline packager, **not WXT**; WXT remains a development option.

## Environment and exact tool versions

The signing workflow runs on the GitHub-hosted Ubuntu 24.04 Linux x86_64 runner
with Node.js 22.23.5. The generated **`BUILD_INFO.json` at the source ZIP root** records
the actual OS release, architecture, Python, exact Node and npm versions and the
locked TypeScript, web-ext and WXT versions for this particular submission.
`package-lock.json` is included. Its current build/sign tools are TypeScript
5.9.3, web-ext 10.5.0 and WXT 0.21.5; use `BUILD_INFO.json` and the lockfile as the
authority if those change in a later submission.

Install the exact Node release recorded there using the official Node binaries
or a Node version manager. If its bundled npm differs, install the recorded npm
version (`npm install --global npm@<recorded-version>`). Python 3.11+ and Git are
needed only for release safety tests/source packaging, not to produce the
extension's JavaScript. npm registry access is needed for dependency installation;
no AMO, Cloudflare or other account credentials are needed to reproduce the build.

## Rebuild from the source ZIP

Extract into a new directory, then run in that directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:offline
npx --no-install web-ext lint --self-hosted --source-dir dist-firefox-offline --warnings-as-errors
```

The complete unsigned payload is **`dist-firefox-offline/`**, including
`manifest.json`, `background.js`, `content.js`, popup and options HTML/JS/CSS.
Compare its file names and bytes with the signed XPI, ignoring only Mozilla's
`META-INF/` signature files. There should be no other differences. The packaging
helper does not modify the JavaScript. `npm test` additionally typechecks core
modules, rebuilds this same payload and runs offline tests (including release
safety tests, which use Git and Python).

The source ZIP contains all build inputs and reviewer instructions; it deliberately
excludes `.git`, `node_modules`, caches, generated output, environment files and
arbitrary JSON/credential files. Each signing submission uploads this matching
ZIP using web-ext's `--upload-source-code` option and includes these reviewer
instructions via `version.approval_notes`.

## Review scope and functionality

This is a technical prototype: Firefox Desktop/Android real-device behavior and
Cloudflare Clef-omni live API/end-to-end behavior remain unverified. Offline tests
use mocked APIs. Signing is not an endorsement or evidence that these features
work end to end. To inspect without Cloudflare credentials, temporarily load the
rebuilt manifest in Firefox and use `fixtures/japanese-form.html`; automated tests
exercise the provider path with a mock.

The extension never submits forms automatically. It stores profiles and the
user-supplied Cloudflare token encrypted locally. When filling, page labels,
field descriptions and URL paths are sent to Cloudflare; actual profile values
are resolved locally rather than included in the decision request body. Review
`README.md` for permission disclosures, limitations and setup instructions.

Official references:
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
- https://nodejs.org/en/download
