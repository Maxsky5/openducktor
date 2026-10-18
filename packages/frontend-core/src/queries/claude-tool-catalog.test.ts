import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { ClaudeToolCatalog } from "@openducktor/contracts";
import { claudeToolCatalogQueryOptions } from "./claude-tool-catalog";

test("pending catalog reads remain isolated by host and runtime identity", async () => {
  const client = new QueryClient();
  const old = Promise.withResolvers<ClaudeToolCatalog>();
  const next = {
    runtimeKind: "claude" as const,
    runtimeId: "new",
    tools: [{ name: "Read", canDisable: true }],
  };
  try {
    const oldOptions = claudeToolCatalogQueryOptions("host-1", "old", () => old.promise);
    const pending = client.fetchQuery(oldOptions);
    const newOptions = claudeToolCatalogQueryOptions("host-1", "new", async () => next);
    expect(await client.fetchQuery(newOptions)).toEqual(next);
    old.resolve({ runtimeKind: "claude", runtimeId: "old", tools: [] });
    await pending;
    expect(client.getQueryData<ClaudeToolCatalog>(newOptions.queryKey)).toEqual(next);
    const otherHost = claudeToolCatalogQueryOptions("host-2", "new", async () => next);
    expect(client.getQueryData(otherHost.queryKey)).toBeUndefined();
    const wrong = claudeToolCatalogQueryOptions("host-1", "wrong", async () => next);
    await expect(client.fetchQuery(wrong)).rejects.toThrow("Claude changed");
  } finally {
    client.clear();
  }
});
