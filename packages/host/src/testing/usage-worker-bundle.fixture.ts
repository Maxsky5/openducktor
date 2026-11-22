import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import type { UsageIndexProgress } from "@openducktor/contracts";
import { Effect } from "effect";
import { createUsageIndexAdapter } from "../adapters/usage/usage-index-adapter";
import { resolveUsageLocations } from "../adapters/usage/usage-locations";
import { createUsageReportService } from "../application/usage/usage-report-service";

// The adapter starts the index and parser bundles next to this bundle.
const root = mkdtempSync(path.join(tmpdir(), "odt-usage-bundle-"));
// The index worker downloads its rates from this server instead of models.dev.
const rates = createServer((_, response) => {
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      openai: { models: { "gpt-6.1-sol": { cost: { input: 2, output: 10, cache_read: 0.1 } } } },
    }),
  );
});
await new Promise<void>((resolve) => rates.listen(0, "127.0.0.1", resolve));
const progressEvents: UsageIndexProgress[] = [];
// SAFETY: a server that listens on a TCP port has an AddressInfo address.
const ratesAddress = rates.address() as AddressInfo;
const index = createUsageIndexAdapter({
  indexPath: path.join(root, "usage-index.sqlite"),
  onProgress: (progress) => progressEvents.push(progress),
  ratesUrl: `http://127.0.0.1:${ratesAddress.port}/api.json`,
});
const lines = (records: unknown[]) =>
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

try {
  const project = path.join(root, "claude", "projects", "-repo");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    path.join(project, "session.jsonl"),
    lines([
      {
        type: "assistant",
        sessionId: "claude-session",
        timestamp: "2026-03-02T10:00:00.000Z",
        cwd: "/repo",
        requestId: "req_1",
        message: {
          id: "msg_1",
          model: "claude-opus-5-5",
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 30,
            output_tokens: 40,
          },
        },
      },
    ]),
  );
  const rollouts = path.join(root, "codex", "sessions", "2026", "03", "02");
  mkdirSync(rollouts, { recursive: true });
  writeFileSync(
    path.join(rollouts, "rollout-2026-03-02T10-00-00-thread.jsonl.zst"),
    zstdCompressSync(
      lines([
        {
          timestamp: "2026-03-02T10:00:00.000Z",
          type: "session_meta",
          payload: { id: "thread", cwd: "/repo", model_provider: "openai", cli_version: "0.160.0" },
        },
        {
          timestamp: "2026-03-02T10:00:01.000Z",
          type: "turn_context",
          payload: { turn_id: "turn", model: "gpt-6.1-sol", cwd: "/repo" },
        },
        {
          timestamp: "2026-03-02T10:00:02.000Z",
          type: "token_usage_record",
          payload: {
            thread_id: "thread",
            session_id: "thread",
            response_id: "resp_1",
            usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 7 },
          },
        },
      ]),
    ),
  );
  const service = createUsageReportService({
    index,
    settingsConfig: {
      readWorkspaceCatalogSnapshot: () =>
        Effect.succeed({ catalogRevision: 0, workspaces: [], workspaceOrder: [] }),
      defaultWorktreeBasePath: () => path.join(root, "worktrees"),
      resolveConfiguredPath: (value) => value,
      join: path.join,
    },
    taskOwnership: { listTaskDirectoriesForWorktreeOwnership: () => Effect.succeed([]) },
    locations: () =>
      resolveUsageLocations(
        {
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
          XDG_DATA_HOME: path.join(root, "data"),
        },
        root,
      ),
    timeZone: () => "UTC",
    now: () => Date.parse("2026-03-03T00:00:00.000Z"),
  });
  // A read of one runtime starts a background catch-up of the other runtimes. The next read
  // goes first and still sees every source.
  const codexOnly = await Effect.runPromise(
    service.read({
      range: { kind: "custom", start: "2026-03-01", end: "2026-03-03" },
      runtime: "codex",
    }),
  );
  assert.deepEqual(
    codexOnly.byRuntime.map(({ runtime, figure }) => [runtime, figure.tokens.processed]),
    [["codex", 107]],
  );
  // The read parsed one rollout, so it reported its progress: the totals first, then the rollup.
  assert.deepEqual(
    progressEvents.map(({ phase, runtimes }) => [phase, runtimes]),
    [
      [
        "reading",
        [
          {
            runtime: "codex",
            sources: { done: 0, total: 1 },
            work: { done: 0, total: progressEvents[0]?.runtimes[0]?.work.total },
            sessions: 0,
          },
        ],
      ],
      [
        "summarizing",
        [
          {
            runtime: "codex",
            sources: { done: 1, total: 1 },
            work: {
              done: progressEvents[0]?.runtimes[0]?.work.total,
              total: progressEvents[0]?.runtimes[0]?.work.total,
            },
            sessions: 1,
          },
        ],
      ],
    ],
  );
  const report = await Effect.runPromise(
    service.read({
      range: { kind: "custom", start: "2026-03-01", end: "2026-03-03" },
      runtime: null,
    }),
  );
  assert.deepEqual(
    report.byRuntime.map(({ runtime, figure }) => [
      runtime,
      figure.tokens.processed,
      figure.sessions,
    ]),
    [
      ["opencode", 0, 0],
      ["codex", 107, 1],
      ["claude", 100, 1],
    ],
  );
  assert.equal(report.coverage.find((entry) => entry.runtime === "opencode")?.state, "no_history");
  // 40 new input, 60 cache reads, and 7 output tokens at the downloaded rates.
  assert.equal(
    report.byRuntime.find((entry) => entry.runtime === "codex")?.figure.cost.usd,
    0.000156,
  );
  assert.equal(report.pricing.issue, null);
  console.log(
    `Worker bundle passed: ${process.versions.electron ? "Electron" : process.versions.bun ? "Bun" : "Node"} usage`,
  );
} finally {
  await Effect.runPromise(index.shutdown());
  rates.close();
  rmSync(root, { recursive: true, force: true });
}
