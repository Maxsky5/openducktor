# SQLite task-store lifecycle benchmark

Run `bun run benchmark:sqlite-task-store-lifecycle` from `packages/host`. The runner executes the source benchmark with Bun, bundles the same benchmark for Node, copies the real Drizzle migrations beside the Node bundle, and uses on-disk temporary databases.

The benchmark compares the current per-operation connection scope with one retained connection guarded by a one-permit semaphore. It measures full task-list reads on empty, small (25 tasks), and representative (250 tasks) stores. It also measures a representative 80/20 sequential read/write mix and concurrent reads with concurrency four. Each variant warms before sampling, and read samples alternate order to limit cache bias.

The gate requires at least 15% improvement at p50 and p95, at least 1 ms saved at p95, less than 5% throughput regression, and no more than one live retained handle per database path. Gate comparisons use raw metrics; the JSON report rounds numbers to three decimal places. The command exits with status 1 when either runtime fails the gate.

## Baseline from 2026-08-13

Platform: macOS 26.5.1 arm64. Runtimes: Bun 1.3.10 and Node 24.14.0.

| Runtime | Store | Current p50/p95 | Retained p50/p95 | p95 saved | Gate |
| --- | --- | ---: | ---: | ---: | --- |
| Bun | empty | 0.273/0.446 ms | 0.088/0.123 ms | 0.323 ms | fail |
| Bun | small | 0.545/1.047 ms | 0.321/0.418 ms | 0.629 ms | fail |
| Bun | representative | 1.670/2.711 ms | 1.430/2.818 ms | -0.107 ms | fail |
| Node | empty | 0.237/0.357 ms | 0.075/0.105 ms | 0.252 ms | fail |
| Node | small | 0.490/1.232 ms | 0.325/0.407 ms | 0.825 ms | fail |
| Node | representative | 1.989/3.742 ms | 1.773/3.112 ms | 0.630 ms | fail |

| Runtime | Sequential mixed change | Concurrent read change | Retained live handles | Gate |
| --- | ---: | ---: | ---: | --- |
| Bun | +34.223% | +12.587% | 1 | pass |
| Node | +18.422% | +16.359% | 1 | pass |

The latency gate failed in both runtimes, so production keeps per-operation connection scopes. The fallback moves recursive directory creation into the shared schema-initialization flight and applies persistent WAL setup only on that initialization connection. Each operation still enables connection-local foreign keys.
