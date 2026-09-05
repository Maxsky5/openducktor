import { expect, test } from "bun:test";
import { notificationRouteSessionIdentity } from "./notification-route-state";

const session = {
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  externalSessionId: "same-native-id",
} as const;
const state = {
  notificationTarget: {
    type: "agent_session" as const,
    repoPath: "/repo",
    taskId: "task",
    session,
  },
};

test("reads the full identity only for the matching workspace, task, and URL session", () => {
  expect(
    notificationRouteSessionIdentity(state.notificationTarget, "/repo", "task", "same-native-id"),
  ).toEqual(session);
  expect(
    notificationRouteSessionIdentity(state.notificationTarget, "/other", "task", "same-native-id"),
  ).toBeNull();
  expect(
    notificationRouteSessionIdentity(state.notificationTarget, "/repo", "other", "same-native-id"),
  ).toBeNull();
  expect(
    notificationRouteSessionIdentity(state.notificationTarget, "/repo", "task", "other"),
  ).toBeNull();
});
