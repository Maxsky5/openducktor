# Worktree snapshot hash performance

Task `openduckto-veqzi` replaces per-byte BigInt FNV-1a arithmetic with two 32-bit words and `Math.imul` in `packages/host/src/application/git/git-worktree-snapshot.ts`.

The byte loop keeps signed words in local variables. It computes the carry from two 16-bit products and converts the final words to unsigned hex. BigInt remains only for each 64-bit length prefix. UTF-8 encoding, little-endian framing, field order, full-content hashing, and the 16-character digest stay unchanged. `hashVersion` stays at 1 because the result is the same FNV-1a-64 digest.

The application layer forbids Node API imports. This implementation uses JavaScript built-ins and needs no dependency, port, contract, or durable schema change.

## Reproduce

Run the benchmark from the repo root. It asserts empty and Unicode hash vectors before measurement.

```sh
bun run scripts/benchmarks/git-worktree-hash.ts
bun build scripts/benchmarks/git-worktree-hash.ts --target=node --outfile=/tmp/odt-worktree-hash.mjs
node /tmp/odt-worktree-hash.mjs
ELECTRON_RUN_AS_NODE=1 apps/electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /tmp/odt-worktree-hash.mjs
```

For the baseline, use the same benchmark with `git-worktree-snapshot.ts` from commit `5fa09d3dc0936ffc091b394e6a09adcb7e33de2b` in a separate checkout. Bundle both revisions with the same Bun version. The Node target bundle uses the production function and each runtime's own JavaScript engine. Electron runs its installed Node engine without starting the GUI.

## Method

The payload contains one ASCII file diff with exactly 1, 5, or 10 MiB of text. Construction occurs before timing. Each size uses one warm-up and five timed hash calls. A separate experiment measures five queued `setImmediate` callbacks with a hash call before yielding and five idle callbacks. The callback metric includes hashing, scheduling, and assertion overhead. It is elapsed callback delay, not a host-wide event-loop histogram.

These measurements exclude Git, transport, rendering, and end-to-end diff loading. They measure synchronous work on the host thread. The loop still blocks that thread while it runs.

## Results

Measured on macOS arm64 on 2026-09-08 local time. The task baseline used Bun 1.3.10. This run also covers the repo tooling version, Bun 1.3.14, standalone Node, and the installed Electron version. Each row reports medians in milliseconds.

Other worktrees ran CPU-intensive checks during this session. These single-machine results show the observed cost, not a stable latency guarantee. No end-to-end speedup is claimed.

| Runtime | MiB | Old hash | New hash | Old callback delay | New callback delay | New idle callback |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bun 1.3.10 | 1 | 31.20 | 2.42 | 31.32 | 3.04 | 0.021 |
| Bun 1.3.10 | 5 | 159.72 | 23.39 | 161.95 | 31.80 | 0.025 |
| Bun 1.3.10 | 10 | 791.58 | 58.16 | 801.90 | 67.22 | 0.016 |
| Bun 1.3.14 | 1 | 31.63 | 2.37 | 32.51 | 2.57 | 0.019 |
| Bun 1.3.14 | 5 | 172.78 | 11.68 | 171.82 | 11.69 | 0.014 |
| Bun 1.3.14 | 10 | 328.86 | 22.80 | 918.41 | 23.86 | 0.018 |
| Node 24.14.0 | 1 | 43.78 | 1.94 | 52.93 | 2.00 | 0.048 |
| Node 24.14.0 | 5 | 355.62 | 9.26 | 248.02 | 9.53 | 0.036 |
| Node 24.14.0 | 10 | 508.02 | 18.38 | 333.06 | 17.85 | 0.024 |
| Electron 44.0.0 / Node 24.18.1 | 1 | 20.79 | 1.79 | 18.32 | 1.72 | 0.052 |
| Electron 44.0.0 / Node 24.18.1 | 5 | 85.61 | 8.15 | 273.08 | 8.16 | 0.025 |
| Electron 44.0.0 / Node 24.18.1 | 10 | 325.80 | 16.19 | 291.87 | 15.60 | 0.033 |

All runtimes returned the same old and new ASCII digests for each size. The new implementation also passed the empty and Unicode vectors on every runtime.

## Verification

The focused tests cover original FNV-1a arithmetic, UTF-8 framing, empty payloads, ordering, field boundaries, same-length edits at the start, middle, and end of a payload, stale status, and version rejection. Service tests verify that stale content and incompatible versions cause zero Git reset calls.

`bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` passed. The host tests and host build also passed after the final arithmetic change.
