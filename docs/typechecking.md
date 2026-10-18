# Type checking

## Required commands

Run `bun run typecheck` from the repository root. The root keeps `bun run --workspaces typecheck`, so local development, `.husky/pre-commit`, and the Linux, macOS, and Windows jobs in `.github/workflows/ci.yml` use the same workspace scripts. The MCP publish workflow also uses its workspace script. A checker failure fails the workspace runner and its caller.

Each standalone workspace runs `bun check -p tsconfig.json`. MCP runs `bun check -p tsconfig.json && bun check -p tsconfig.scripts.json`. Keep the explicit project paths. The repository has no root `tsconfig.json`, and `bun check .` does not replace these checks.

The migration changes no TypeScript configuration. Each configuration keeps its file scope, compiler options, path aliases, ambient types, and test exclusions.

| Workspace directory | Standalone configurations |
|---|---|
| `apps/electron` | `tsconfig.json` |
| `packages/adapters-codex-app-server` | `tsconfig.json` |
| `packages/adapters-opencode-sdk` | `tsconfig.json` |
| `packages/build-tools` | `tsconfig.json` |
| `packages/contracts` | `tsconfig.json` |
| `packages/core` | `tsconfig.json` |
| `packages/frontend` | `tsconfig.json` |
| `packages/host` | `tsconfig.json` |
| `packages/host-client` | `tsconfig.json` |
| `packages/openducktor-mcp` | `tsconfig.json`, `tsconfig.scripts.json` |
| `packages/openducktor-web` | `tsconfig.json` |
| `packages/path-support` | `tsconfig.json` |
| `packages/remote-host` | `tsconfig.json` |
| `packages/runtime-orchestration` | `tsconfig.json` |
| `tools/oxlint/anti-slop` | `tsconfig.json` |

These are 16 configurations across 15 workspaces. The website adds its Astro check. `packages/host/tsconfig.build.json` remains a build configuration, separate from the host's standalone check.

## Compiler versions and limits

Use Bun `1.4.3` and standalone TypeScript `7.0.2`. Bun `1.4.3` is the latest stable release checked on 2026-10-18. Its checker bundles TypeScript `7.0.2` compiler behavior and standard library declarations. The root pins TypeScript to that exact version for declaration builds and editor tooling. Package metadata, contributor setup instructions, and all workflows pin the same Bun release.

The [Bun 1.4.3 release](https://bun.sh/blog/bun-v1.4.3) records compiler conformance results and some remaining differences, including recursive inference cases. It does not promise that every program has the same diagnostics as TypeScript. [Bun PR #45217](https://github.com/oven-sh/bun/pull/45217) merged on 2026-10-14, after this release. It fixes an inference hang, missed loop diagnostics, and false errors. Bun `1.4.3` does not include those fixes. Check the next stable release for them before an upgrade. Do not use a canary, suppress compiler failures, or add a required TypeScript comparison gate to work around a compiler defect.

When a compiler hangs, crashes, or disagrees with the matching TypeScript version, keep the failure visible. Record the failing configuration and a small reproduction for upstream. A temporary `tsc -p <config> --noEmit` comparison can help diagnose it. It is not a second required standalone gate.

The [Bun checker contract](https://bun.com/docs/runtime/check) states that `bun check` only checks types. It does not emit JavaScript, declarations, source maps, or `.tsbuildinfo`. It does not read or reuse TypeScript's `.tsbuildinfo` caches. Each run checks the whole project. Keep the existing `tsc` build commands for declaration output, including MCP's published `dist/index.d.ts`.

Bun upgrades can change compiler behavior even when the installed `typescript` package does not change. After an upgrade, inspect `bun -p process.versions.typescript` and align the root TypeScript version. Run all five repository checks, compare all standalone configurations when compiler behavior changes, and check published declaration output. Editors must continue to use a TypeScript 7 language service as described in [Contributing](../CONTRIBUTING.md#local-tooling-reference).

## Astro exception

The website keeps `astro check --minimumFailingSeverity warning` as its required `typecheck` script. Both warnings and errors must fail. A plain TypeScript check cannot replace Astro template diagnostics.

The installed `@astrojs/check` `0.9.10` accepts TypeScript 5 or 6. The installed `@astrojs/language-server` `2.17.1` rejects TypeScript 7 because it has no JavaScript compiler API. Keep the website's workspace-local TypeScript `^6.0.0` dependency. Do not replace it with the root compiler, a custom compiler bridge, a dependency patch, or a fork. A TypeScript 7 upgrade for Astro needs official upstream support and is outside this migration. See [Astro's rejection](https://github.com/withastro/astro/pull/17345) and [compatibility tracking](https://github.com/withastro/roadmap/discussions/1321).

## Parallelism and verification

`bun run --workspaces typecheck` keeps workspace parallelism. Each `bun check` uses one thread per CPU core by default. Measure total workspace time and memory before adding a `--threads` limit, because simultaneous workspace processes already share the runner's CPUs and memory. See the [Bun CI contract](https://bun.com/docs/runtime/check#run-in-ci).

See [migration verification](verification/bun-check-migration.md) for local comparison results, failure probes, declaration output checks, and hosted CI evidence.
