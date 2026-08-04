# Publishing `@~lyre/dataport`

This package publishes to npm automatically on push to `main`, using **npm
Trusted Publishing** (OIDC) — no `NPM_TOKEN` secret required. The workflow lives
at [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

It ships **built outputs** from `dist/`. Unlike the other `@~lyre/*` SDKs, this
package emits **both ESM and CJS** (`tsup --format esm,cjs`), because its primary
consumer is a CommonJS NestJS service — `exports` maps `import` to
`dist/index.js` and `require` to `dist/index.cjs`. The workflow builds before
publishing, and the `files` allowlist limits the tarball to `dist/`, `README.md`,
and `LICENSE`.

The workflow also runs the test suite (`npm test`, vitest) before publishing, so
a failing test blocks the release.

Verify locally before publishing:

```bash
npm run build && npm run check && npm test
npm pack --dry-run   # prints the exact tarball contents
```

## One-time setup

### 1. Confirm scope ownership on npmjs.com

Own the `@~lyre` scope (`https://www.npmjs.com/settings/~lyre`) — the same scope
as `@~lyre/ai-agents`, `@~lyre/auth`, and the other `@~lyre/*` packages.

### 2. First-time publish (bootstrap)

Trusted Publishing can only attach to a package that already exists, so do the
first publish manually:

```bash
npm login
npm publish --access public   # one time only
```

`@~lyre/dataport` has never been published (`npm view` returns a 404), so this
bootstrap step is required — version `0.1.0` is the first published version.

### 3. Configure Trusted Publishing

On npmjs.com, open **Settings → Trusted publishers → Add publisher**:

- **Publisher**: GitHub Actions
- **Organization or user**: `kigathi-chege`
- **Repository**: `lyre-dataport`
- **Workflow filename**: `publish.yml`
- **Environment name**: `Home`

The **Repository** value must match the actual GitHub remote exactly, or OIDC
publishes are rejected.

### 4. Create the `Home` GitHub environment

In the repo's GitHub settings → **Environments**, create `Home`. The workflow
declares `environment: Home` unconditionally, so **the job will not run until
this environment exists**. Optionally gate it behind required reviewers.

## Day-to-day

1. Bump `version` in `package.json`.
2. Commit, push to `main`.
3. The workflow compares local vs npm and publishes only when they differ.
   Unchanged versions are skipped. You can also trigger it manually from the
   **Actions** tab (`workflow_dispatch`).

## Versioning

Semver. Breaking changes in `0.x` bump the minor; bug fixes bump the patch.

## Consumers

`inbox/apps/service` currently depends on this package via a `file:` path for
local development. Once `0.1.0` is live on npm, that can switch to a `^0.1.0`
semver range.
