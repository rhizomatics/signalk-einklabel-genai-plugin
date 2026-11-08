# signalk-einklabel-genai-plugin Development

## Release

Releases go to npm through [.github/workflows/release.yml](.github/workflows/release.yml), using npm
trusted publishing (OIDC, with provenance). No npm token exists. The workflow **stages** each
version and it goes live when you approve it (`policies/signalk-alignment.md` in `rhizomatics/hq`).

1. Set the version in `package.json` and finish its section in `CHANGELOG.md`:

   ```bash
   npm version <VERSION> --no-git-tag-version
   ```

2. Commit and push, then wait for the SignalK Plugin CI workflow to pass on GitHub.

3. Check what the package will contain:

   ```bash
   npm pack --dry-run
   ```

4. Create the GitHub release, with the version's `CHANGELOG.md` section as its notes. Its tag must
   be `v` + the `package.json` version, or the workflow fails:

   ```bash
   gh release create v<VERSION> --target main --title v<VERSION> --notes-file <notes.md>
   ```

5. Approve the staged version: npmjs.com → package → **Staged Packages**, or
   `npm stage approve <stage-id>` (both need 2FA).

6. Move the `latest` git tag (version tags never move):

   ```bash
   git fetch --tags
   git tag -f latest v<VERSION>
   git push -f origin latest
   ```

### Pre-releases

The npm dist-tag comes from the release tag: one containing `alpha`, `beta` or `rc` publishes under
that dist-tag; any other release marked pre-release on GitHub goes to `next`. npm refuses a
prerelease version such as `1.4.0-beta.1` without an explicit dist-tag, so use one of the first three:

```bash
gh release create v1.4.0-beta.1 --target main --prerelease --title v1.4.0-beta.1 --notes-file <notes.md>
```

### One-off setup

- npmjs.com → package **Settings** → **Trusted Publisher** → GitHub Actions: org `rhizomatics`, repo
  `signalk-einklabel-genai-plugin`, workflow `release.yml`, environment `npm`, allowed action **stage publish**
  only. A trusted publisher that publishes nothing within 2 days expires.
- Under **Publishing access**, choose "Require two-factor authentication and disallow tokens".
- GitHub repo → **Settings** → **Environments** → create `npm`.

## Run Local CLI

The `esl-cli` binary lives in [`@rhizomatics/signalk-einklabel-plugin`](https://github.com/rhizomatics/signalk-einklabel-plugin),
not in this package. `-r`/`--require`ing this package's bare name only loads its `main` entry
(`dist/index.js`, the SignalK plugin factory) - the `prompt`/`generate` subcommands contributed by
[`src/cliExtension.ts`](src/cliExtension.ts) live behind the `./cli` subpath export instead:

```bash
npx esl-cli -r @rhizomatics/signalk-einklabel-genai-plugin/cli prompt --help
```

That `require()` is resolved by Node from inside the base plugin's own `node_modules`, so this
package has to be discoverable under that name in `node_modules` first - `npm install` alone won't
do it, since this repo is the project root, not a dependency of itself. Link it once per clone:

```bash
npm link
npm link @rhizomatics/signalk-einklabel-genai-plugin
```

This creates a self-referencing `node_modules/@rhizomatics/signalk-einklabel-genai-plugin` symlink
back to the repo root. Re-run `npm run build` after code changes - the CLI loads the compiled
`dist/`, not `src/`.
