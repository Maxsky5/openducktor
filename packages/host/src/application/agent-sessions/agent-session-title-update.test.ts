import { expect, test } from "bun:test";
import type { AgentSessionSummary, AgentSessionTitleUpdateResult } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import { commitTitleUpdate } from "./agent-session-title-update";

const summary: AgentSessionSummary = {
  externalSessionId: "native",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  title: "Renamed",
  sessionAssociation: { kind: "repository", title: "Renamed" },
  startedAt: "2026-09-01T00:00:00Z",
  status: "idle",
};

const renamed: AgentSessionTitleUpdateResult = { status: "renamed", summary };

test("passes a not attached result through without a commit", async () => {
  let commits = 0;
  const outcome = await Effect.runPromise(
    commitTitleUpdate(
      { status: "not_attached" },
      () => Effect.sync(() => void (commits += 1)),
      () => Effect.void,
    ),
  );
  expect(outcome).toEqual({ status: "not_attached" });
  expect(commits).toBe(0);
});

test("reports a renamed outcome after a successful commit", async () => {
  const committed: AgentSessionSummary[] = [];
  const outcome = await Effect.runPromise(
    commitTitleUpdate(
      renamed,
      (value) =>
        Effect.sync(() => {
          committed.push(value);
        }),
      () => Effect.void,
    ),
  );
  expect(outcome).toEqual({ status: "renamed" });
  expect(committed).toEqual([summary]);
});

test("keeps the renamed outcome and reports a projection fault when the commit fails", async () => {
  const failure = new HostOperationError({ operation: "test.commit", message: "commit failed" });
  const reported: HostError[] = [];
  const outcome = await Effect.runPromise(
    commitTitleUpdate(
      renamed,
      () => Effect.fail(failure),
      (value) =>
        Effect.sync(() => {
          reported.push(value);
        }),
    ),
  );
  expect(outcome).toEqual({ status: "renamed" });
  expect(reported).toEqual([failure]);
});

test("fails with both errors when the projection fault report also fails", async () => {
  const commitFailure = new HostOperationError({
    operation: "test.commit",
    message: "commit failed",
  });
  const reportFailure = new HostOperationError({
    operation: "test.report",
    message: "report failed",
  });
  const error = await Effect.runPromise(
    Effect.flip(
      commitTitleUpdate(
        renamed,
        () => Effect.fail(commitFailure),
        () => Effect.fail(reportFailure),
      ),
    ),
  );
  expect(error).toBeInstanceOf(HostOperationError);
  expect(error.message).toContain("commit failed");
  expect(error.message).toContain("report failed");
});
