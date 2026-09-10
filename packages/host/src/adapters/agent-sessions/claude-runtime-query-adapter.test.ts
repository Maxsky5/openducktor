import { expect, test } from "bun:test";
import { Effect } from "effect";
import { fromPromise } from "../claude/claude-agent-sdk-utils";
import { toClaudeSkillCatalog } from "../claude/claude-agent-sdk-catalog";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { createClaudeRuntimeQueryAdapter } from "./claude-runtime-query-adapter";

test("malformed Claude catalog data remains an invalid runtime response through the wrapper", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    listAvailableSkills: () =>
      fromPromise("claudeRuntime.listAvailableSkills", async () =>
        toClaudeSkillCatalog([
          { name: "", description: "secret http://127.0.0.1:9999", argumentHint: "" },
        ]),
      ),
  });
  const failure = await Effect.runPromise(
    Effect.flip(
      adapter.listAvailableSkills({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
      }),
    ),
  );
  expect(failure.failure.code).toBe("invalid_runtime_response");
  expect(failure.failure.detail).toContain("invalid query data");
  expect(JSON.stringify(failure.failure)).not.toContain("secret");
  expect(JSON.stringify(failure.failure)).not.toContain("127.0.0.1");
});

test("unknown wrapped Claude failures keep connection details inside the host", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    listAvailableSkills: () =>
      fromPromise("claudeRuntime.listAvailableSkills", async () => {
        throw new Error("secret http://127.0.0.1:9999");
      }),
  });
  const failure = await Effect.runPromise(
    Effect.flip(
      adapter.listAvailableSkills({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
      }),
    ),
  );
  expect(failure.failure.code).toBe("request_failed");
  expect(JSON.stringify(failure.failure)).not.toContain("secret");
  expect(JSON.stringify(failure.failure)).not.toContain("127.0.0.1");
});
