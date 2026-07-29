# signalk-einklabel-genai-plugin Development

## Release

```bash
npm login
git tag -f latest
git tag -f v0.1.1
git push --tags
npm publish --tag latest --access public
```

GitHub release

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
