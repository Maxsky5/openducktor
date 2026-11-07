import { specPlanBuildWorkflow } from "@openducktor/workflows";

import { describe, expect, test } from "bun:test";
import { resolveLaunchStartMode } from "./session-start-mode";

describe("resolveLaunchStartMode", () => {
  test("keeps the default fresh mode when it does not require an existing session", () => {
    expect(
      resolveLaunchStartMode({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "build_implementation_start",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("prefers reuse when reusable sessions exist", () => {
    expect(
      resolveLaunchStartMode({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "build_after_human_request_changes",
        existingSessionOptions: [
          {
            value: "session-1",
            sourceSession: {
              externalSessionId: "session-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "Builder #1",
            description: "Existing builder session",
          },
        ],
      }),
    ).toBe("reuse");
  });

  test("falls back to the first allowed non-reuse mode when no reusable sessions exist", () => {
    expect(
      resolveLaunchStartMode({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "build_implementation_start",
        existingSessionOptions: [],
      }),
    ).toBe("fresh");
  });

  test("keeps reuse as the default when the launch action allows reuse and fork", () => {
    expect(
      resolveLaunchStartMode({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "pull_request",
        existingSessionOptions: [],
      }),
    ).toBe("reuse");
  });

  test("keeps reuse as the manual QA default when a QA session exists", () => {
    expect(
      resolveLaunchStartMode({
        taskWorkflow: specPlanBuildWorkflow,
        launchActionId: "qa_review",
        existingSessionOptions: [
          {
            value: "qa-session-1",
            sourceSession: {
              externalSessionId: "qa-session-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
            },
            label: "QA #1",
            description: "Existing QA session",
          },
        ],
      }),
    ).toBe("reuse");
  });
});
