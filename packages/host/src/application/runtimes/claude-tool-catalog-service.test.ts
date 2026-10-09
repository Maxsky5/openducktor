import { expect, mock, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR, type RuntimeInstanceSummary } from "@openducktor/contracts";
import { Effect } from "effect";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { createClaudeToolCatalogService } from "./claude-tool-catalog-service";

const runtime = (runtimeId = "r"): RuntimeInstanceSummary => ({
  runtimeId,
  kind: "claude",
  runtimeRoute: { type: "host_service", identity: runtimeId },
  descriptor: CLAUDE_RUNTIME_DESCRIPTOR,
  startedAt: "2026-10-09T00:00:00Z",
});

test("reads only the selected ready service and rejects replacement during the read", async () => {
  let current = runtime();
  const load = mock(() =>
    Effect.succeed({ runtimeKind: "claude" as const, runtimeId: "r", tools: [] }),
  );
  const adapter = createAgentSessionRuntimeAdapterTestDouble(
    { runtimeId: "r", runtimeKind: "claude" },
    { claudeToolCatalog: { load } },
  );
  const service = createClaudeToolCatalogService({
    runtimeRegistry: { requireReady: () => Effect.succeed(current) },
    adapterRegistry: { list: () => [adapter] },
  });
  expect(await Effect.runPromise(service.load({ runtimeId: "r" }))).toMatchObject({
    runtimeId: "r",
  });
  await expect(Effect.runPromise(service.load({ runtimeId: "old" }))).rejects.toThrow(
    "Reload Settings",
  );
  expect(load).toHaveBeenCalledTimes(1);
  load.mockImplementation(() =>
    Effect.sync(() => {
      current = runtime("replacement");
      return { runtimeKind: "claude" as const, runtimeId: "r", tools: [] };
    }),
  );
  await expect(Effect.runPromise(service.load({ runtimeId: "r" }))).rejects.toThrow(
    "Reload Settings",
  );
});
