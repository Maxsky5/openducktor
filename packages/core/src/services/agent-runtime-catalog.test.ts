import { expect, test } from "bun:test";
import { AgentRuntimeQueryError } from "../ports/agent-runtime-query-error";
import { readAgentRuntimeCatalogSurface } from "./agent-runtime-catalog";

test("returns an available surface for a successful read", async () => {
  const surface = await readAgentRuntimeCatalogSurface(async () => ({ skills: [] }));

  expect(surface).toEqual({ status: "available", catalog: { skills: [] } });
});

test("keeps a surface-specific failure inside the surface", async () => {
  const cause = new Error("skill payload is not a list");
  const surface = await readAgentRuntimeCatalogSurface(async () => {
    throw cause;
  });

  expect(surface).toEqual({ status: "failed", cause });
});

test("rethrows a native runtime-query failure for the whole combined read", async () => {
  const cause = new AgentRuntimeQueryError("runtime_unavailable", "The runtime is not reachable.");

  await expect(
    readAgentRuntimeCatalogSurface(async () => {
      throw cause;
    }),
  ).rejects.toBe(cause);
});
