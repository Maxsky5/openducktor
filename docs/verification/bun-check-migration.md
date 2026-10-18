# Bun check migration verification

## Environment and method

The local run on 2026-10-18 used macOS arm64, an 18-core Apple M5 Pro, 64 GiB of memory, Node `24.14.0`, Bun `1.4.3`, and TypeScript `7.0.2`. Bun ran from an isolated executable on `PATH`; the system Bun installation stayed unchanged. `bun install --frozen-lockfile` passed with the final dependency metadata. The website resolved its own TypeScript `6.0.3` dependency.

The timing comparison used three samples for each case and reports the median. Both checkers used the same source, dependencies, and Bun workspace runner. Before migration, the workspace scripts ran TypeScript. After migration, they ran Bun. The commands used `/usr/bin/time -l` for wall time and maximum resident set size. Memory uses decimal MB. For parallel runs, this is the largest child process measurement, not the sum of concurrent workspace memory. These local measurements do not predict hosted CI performance.

The standalone parallel command excluded Astro in both cases:

```sh
bun run --filter '*' --filter '!@openducktor/marketing-website' typecheck
```

Individual samples ran in `packages/frontend` or `packages/host` with `tsc -p tsconfig.json --noEmit` or `bun check -p tsconfig.json`. An unmeasured first run populated the TypeScript caches before warm samples. Each fresh parallel sample removed generated `.tsbuildinfo` files under `packages/` before the run. Warm parallel samples retained them. No filesystem cache flush ran. Bun never uses those compiler caches.

## Timing and memory

| Case | TypeScript time | Bun time | TypeScript max RSS | Bun max RSS |
|---|---|---|---|---|
| Frontend, warm | 3.168 s | 0.756 s | 3214.2 MB | 922.7 MB |
| Host, warm | 0.461 s | 0.689 s | 718.5 MB | 855.5 MB |
| All 16 configurations, parallel, fresh | 17.340 s | 5.162 s | 4683.7 MB | 1161.5 MB |
| All 16 configurations, parallel, warm | 7.729 s | 4.838 s | 4576.0 MB | 1143.5 MB |

Warm TypeScript host checks were faster and used less memory than Bun in this run. The full standalone workspace command was faster with Bun in both cache states. Fresh parallel samples ranged from 14.362 to 17.580 seconds for TypeScript and 3.209 to 5.250 seconds for Bun. Warm parallel samples ranged from 6.614 to 13.414 seconds for TypeScript and 4.702 to 5.065 seconds for Bun. Workspace contention and operating system caches affect repeat runs.

All 16 configurations passed under each compiler during this comparison. The frontend has no incremental compiler cache in its configuration. The host has `composite: true`, so its warm TypeScript samples can reuse `.tsbuildinfo`.

The frontend thread comparison also used three samples per limit:

| Bun threads | Median time | Median max RSS |
|---|---|---|
| 1 | 3.371 s | 686.9 MB |
| 2 | 2.531 s | 634.9 MB |
| 4 | 1.547 s | 675.8 MB |
| Default, 18 cores | 0.756 s | 922.7 MB |

The local data does not justify a fixed thread cap. The required workspace scripts keep Bun's default thread count. Hosted runner results must also show that the default completes within the CI limits.

## Failure propagation and build output

Temporary files exercised the installed commands without mocks. Each probe removed its file in `finally`.

| Probe | Command | Result |
|---|---|---|
| `const value: number = "wrong"` in frontend source | `bun run typecheck` | TS2322, exit 1 |
| Same error in MCP `scripts/` | `bun check -p tsconfig.json` in MCP | Exit 0, source scope excludes the probe |
| Same error in MCP `scripts/` | `bun check -p tsconfig.scripts.json` in MCP | TS2322, exit 1 |
| Same error in MCP `scripts/` | `bun run typecheck` | MCP reports TS2322, root exits 1 |
| Number assignment error in an Astro template | Website `typecheck` | One error, exit 1 |
| Unterminated HTML comment in an Astro template | Website `typecheck` | Zero errors, one warning, exit 1 |

The website command was `bun run --filter @openducktor/marketing-website typecheck`. Its warning probe used `<p>ok</p>` followed by `<!-- unclosed`. Older compiler warning examples such as `set:html` with children do not produce a warning through the installed Astro 7 checker. The final probe used a warning from the installed `@astrojs/astro2tsx` converter.

The unchanged root runner still discovers all 16 standalone checks and the website. The unchanged Git hook and CI matrix call that runner. No TypeScript configuration, build command, or hook command changed. A clean root `bun run typecheck` passed after probe removal.

All five full repository checks passed with Bun `1.4.3`:

| Command | Result |
|---|---|
| `bun run format:check` | Passed |
| `bun run lint` | Passed |
| `bun run typecheck` | Passed, 10.298 s |
| `bun run test` | Passed, 14,915 passed and 10 skipped, 93.294 s |
| `bun run build` | Passed, 11.486 s |

The build ran MCP's unchanged `tsc -p tsconfig.json --emitDeclarationOnly` step after deleting its output directory. The new `packages/openducktor-mcp/dist/index.d.ts` exists at the package's declared `types` and export path. The build also produced the MCP JavaScript entry, web CLI, Electron main bundle, and website output. No stale MCP declaration cache could satisfy this build.

`bun run --filter @openducktor/mcp publish:dry-run` listed the fresh declaration files in the package, then exited 1 because this machine has no npm authentication. The five required repository checks passed. The publishing workflow uses npm Trusted Publisher; publishing authentication was not part of this local check.

## Hosted checks

Hosted CI validation is pending.
