# Type checking

## Required commands

Run `bun run typecheck` from the repository root. The root keeps `bun run --workspaces typecheck`, so local development, `.husky/pre-commit`, and the Linux, macOS, and Windows jobs in `.github/workflows/ci.yml` use the same workspace scripts. The MCP publish workflow also uses its workspace script. A checker failure fails the workspace runner and its caller.

Each workspace lists the projects that it checks in the `typecheck` script of its `package.json`. Keep the explicit project paths. The repository has no root `tsconfig.json`. For a single workspace, run `bun run --filter <workspace-name> typecheck`. [Root scripts](../package.json)

Some workspaces need different compiler settings for different inputs. The mobile app checks its app sources without DOM types and uses separate projects for its tests and tools. Frontend core also checks Expo compatibility. The workflows test project checks its compile-only public contract tests. The host uses `tsconfig.build.json` for its build. [Mobile scripts](../apps/mobile/package.json), [Frontend core scripts](../packages/frontend-core/package.json), [Workflows scripts](../packages/workflows/package.json), [Host scripts](../packages/host/package.json)

## Compiler versions and limits

Use the Bun version in the root manifest's `packageManager` field. GitHub Actions reads the same field. [Root package manifest](../package.json)

The verification on 2026-10-18 used Bun `1.4.3`. Its checker uses TypeScript `7.0.2` and its standard library declarations. The root pins TypeScript to that exact version for declaration builds and editor tooling.

The [Bun 1.4.3 release](https://bun.sh/blog/bun-v1.4.3) records compiler conformance results and some remaining differences, including recursive inference cases. It does not promise that every program has the same diagnostics as TypeScript. [Bun PR #45217](https://github.com/oven-sh/bun/pull/45217) merged on 2026-10-14, after this release. It fixes an inference hang, missed loop diagnostics, and false errors. Bun `1.4.3` does not include those fixes. Check the next stable release for them before an upgrade. Do not use a canary, suppress compiler failures, or add a required TypeScript comparison gate to work around a compiler defect.

When a compiler hangs, crashes, or disagrees with the matching TypeScript version, keep the failure visible. Record the failing configuration and a small reproduction for upstream. A temporary `tsc -p <config> --noEmit` comparison can help diagnose it. It is not a second required standalone gate.

The [Bun checker contract](https://bun.com/docs/runtime/check) states that `bun check` only checks types. It does not emit JavaScript, declarations, source maps, or `.tsbuildinfo`. It does not read or reuse TypeScript's `.tsbuildinfo` caches. Each run checks the whole project. Use `tsc` to generate declarations for packages that export a library API.

Bun upgrades can change compiler behavior even when the installed `typescript` package does not change. After an upgrade, inspect `bun -p process.versions.typescript` and align the root TypeScript version. Run all five repository checks, compare all standalone configurations when compiler behavior changes, and check published declaration output. Editors must continue to use a TypeScript 7 language service as described in [Contributing](../CONTRIBUTING.md#local-tooling-reference).

## Astro exception

The website keeps `astro check --minimumFailingSeverity warning` as its required `typecheck` script. Both warnings and errors must fail. A plain TypeScript check cannot replace Astro template diagnostics.

The installed `@astrojs/check` `0.9.10` accepts TypeScript 5 or 6. The installed `@astrojs/language-server` `2.17.1` rejects TypeScript 7 because it has no JavaScript compiler API. Keep the website's workspace-local TypeScript `^6.0.0` dependency. Do not replace it with the root compiler, a custom compiler bridge, a dependency patch, or a fork. A TypeScript 7 upgrade for Astro needs official upstream support and is outside this migration. See [Astro's rejection](https://github.com/withastro/astro/pull/17345) and [compatibility tracking](https://github.com/withastro/roadmap/discussions/1321).

## Next.js build check

The docs website runs `bun check -p tsconfig.json` as its required `typecheck` script, like the other workspaces. Its `next build` also checks types. Next.js needs the TypeScript JavaScript API for that check, which TypeScript 7 does not have. Keep the docs website's workspace-local TypeScript `^6.0.0` dependency for the build. Do not turn off the build check or replace it with a custom compiler bridge.

## Parallelism and verification

`bun run --workspaces typecheck` keeps workspace parallelism. Each `bun check` uses one thread per CPU core by default. Measure total workspace time and memory before adding a `--threads` limit, because simultaneous workspace processes already share the runner's CPUs and memory. See the [Bun CI contract](https://bun.com/docs/runtime/check#run-in-ci).

See [migration verification](verification/bun-check-migration.md) for local comparison results, failure probes, declaration output checks, and hosted CI evidence.
