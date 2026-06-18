import { describe, expect, test } from "bun:test";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { isRepoRuntimeStarting } from "./repo-runtime-health";

describe("repo runtime health", () => {
  test("reports startup stages as runtime starting", () => {
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "startup_requested",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
          },
        }),
      ),
    ).toBe(true);
  });

  test("does not report MCP checks after runtime readiness as runtime starting", () => {
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
          },
          mcp: {
            status: "checking",
          },
        }),
      ),
    ).toBe(false);
  });

  test("does not report idle runtimes as starting just because MCP is waiting", () => {
    expect(
      isRepoRuntimeStarting(
        createRepoRuntimeHealthFixture({
          status: "not_started",
          runtime: {
            status: "not_started",
            stage: "idle",
          },
          mcp: {
            status: "waiting_for_runtime",
          },
        }),
      ),
    ).toBe(false);
  });
});
