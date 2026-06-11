import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createAgentSessionRecord,
  expectFailureTag,
} from "../../ports/task-store-port-contract.test-support";
import { agentSessionsFromRow, labelsFromRow, normalizeLabels } from "./sqlite-json-codecs";
import { taskRowFixture } from "./sqlite-task-row-test-fixtures";

describe("SQLite JSON codecs", () => {
  test("normalizes labels by trimming, de-duplicating, and sorting", () => {
    expect(normalizeLabels([" backend ", "ui", "", "backend", " ops "])).toEqual([
      "backend",
      "ops",
      "ui",
    ]);
  });

  test("rejects corrupted label JSON through the Effect error channel", async () => {
    const failure = await expectFailureTag(
      labelsFromRow(taskRowFixture({ labelsJson: "{" })),
      "SqliteTaskStoreDataError",
    );

    expect(failure).toMatchObject({ field: "labels_json" });
  });

  test("rejects label JSON that is not an array of strings", async () => {
    const failure = await expectFailureTag(
      labelsFromRow(taskRowFixture({ labelsJson: JSON.stringify(["ok", 42]) })),
      "SqliteTaskStoreDataError",
    );

    expect(failure).toMatchObject({ field: "labels_json" });
  });

  test("sorts decoded agent sessions from newest to oldest", async () => {
    const sessions = await Effect.runPromise(
      agentSessionsFromRow(
        taskRowFixture({
          agentSessionsJson: JSON.stringify([
            createAgentSessionRecord({
              externalSessionId: "older",
              startedAt: "2026-06-10T10:00:00.000Z",
            }),
            createAgentSessionRecord({
              externalSessionId: "newer",
              startedAt: "2026-06-10T11:00:00.000Z",
            }),
          ]),
        }),
      ),
    );

    expect(sessions.map((session) => session.externalSessionId)).toEqual(["newer", "older"]);
  });
});
