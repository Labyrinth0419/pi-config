# @gandazgul/plannotator-pi-extension-compiled

Compiled wrapper around `@plannotator/pi-extension` to support consumption from Deno and other environments that do not support direct TypeScript imports from npm packages.

## Why this exists

Deno (and some other runtimes) cannot directly import `.ts` files from within npm packages resolved via the `npm:` specifier. This package provides a pre-compiled version of the Plannotator Pi extension with patched imports for compatibility.

## Versioning Policy

This package **aligns its version numbers with the upstream `@plannotator/pi-extension` package**.
- If upstream is at `0.19.17`, this package will also be at `0.19.17`.
- A daily GitHub Action checks for new upstream releases and automatically builds/publishes an aligned version.

## Exports

- `@gandazgul/plannotator-pi-extension-compiled`: The main extension entry point.
- `@gandazgul/plannotator-pi-extension-compiled/server`: The plan review server implementation.
- `@gandazgul/plannotator-pi-extension-compiled/assets`: A module exporting `plannotatorHtml` as a string for in-process serving.

## Usage (Deno)

Add to your `deno.json`:

```json
{
  "imports": {
    "@gandazgul/plannotator-pi-extension-compiled": "npm:@gandazgul/plannotator-pi-extension-compiled@^0.19.17",
    "@gandazgul/plannotator-pi-extension-compiled/server": "npm:@gandazgul/plannotator-pi-extension-compiled@^0.19.17/server",
    "@gandazgul/plannotator-pi-extension-compiled/assets": "npm:@gandazgul/plannotator-pi-extension-compiled@^0.19.17/assets"
  }
}
```

## Build

To build the project locally:

```bash
npm ci
npm run build
```

The build process uses `esbuild` to bundle the TypeScript source from `@plannotator/pi-extension` and patches Node.js built-in imports to use the `node:` prefix for Deno compatibility.

## License

This package is licensed under `MIT OR Apache-2.0`, matching the upstream `@plannotator/pi-extension` package.

See [LICENSE](LICENSE), [LICENSE-MIT](LICENSE-MIT), and [LICENSE-APACHE](LICENSE-APACHE).

## Auto-Update Mechanism

This repository includes a GitHub Action ([`auto-update.yml`](.github/workflows/auto-update.yml)) that:
1. Runs daily at 06:00 UTC.
2. Checks the latest version of `@plannotator/pi-extension` on npm.
3. If a newer version is found, it updates `package.json`, performs a build, tags the release, and pushes to GitHub.
4. The tag push triggers the `npm-publish.yml` workflow to release to the npm registry.
