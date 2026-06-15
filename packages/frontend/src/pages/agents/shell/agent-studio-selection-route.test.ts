import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  resolveAgentStudioRouteSelectionParams,
  resolveAgentStudioSelectionBaseParams,
  resolveAgentStudioViewSelectionParams,
} from "./agent-studio-selection-route";

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("agent-studio-selection-route", () => {
  test("clears query selection while the repo navigation boundary is pending", () => {
    const baseParams = resolveAgentStudioSelectionBaseParams({
      isRepoNavigationBoundaryPending: true,
      taskIdParam: "task-1",
      sessionKeyParam: agentSessionIdentityKey(sessionIdentity("session-1")),
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectionIntent: {
        taskId: "task-2",
        role: "qa",
        sessionIdentity: sessionIdentity("session-2"),
      },
    });

    expect(baseParams).toEqual({
      taskIdParam: "",
      sessionKeyParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectionIntent: null,
    });
  });

  test("uses selection intent as the route selection until the URL catches up", () => {
    const session = sessionIdentity("session-2");
    const routeParams = resolveAgentStudioRouteSelectionParams({
      taskIdParam: "task-1",
      sessionKeyParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectionIntent: {
        taskId: "task-2",
        role: "build",
        sessionIdentity: session,
      },
    });

    expect(routeParams).toEqual({
      taskIdParam: "task-2",
      sessionKeyParam: agentSessionIdentityKey(session),
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      keepExplicitRoleSessionless: false,
    });
  });

  test("drops query session and explicit role when the visible tab is detached from the route", () => {
    const routeSession = sessionIdentity("session-route");
    const viewParams = resolveAgentStudioViewSelectionParams({
      baseParams: {
        taskIdParam: "task-1",
        sessionKeyParam: agentSessionIdentityKey(routeSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "qa",
        selectionIntent: null,
      },
      routeTaskId: "task-1",
      viewTaskId: "task-2",
    });

    expect(viewParams).toMatchObject({
      sessionKeyParam: null,
      sessionIdentity: null,
      hasExplicitRoleSelection: false,
      roleSelection: "qa",
      fallbackRole: "spec",
      keepExplicitRoleSessionless: false,
      selectionIntent: null,
    });
  });

  test("keeps a matching sessionless intent sessionless for the visible tab", () => {
    const viewParams = resolveAgentStudioViewSelectionParams({
      baseParams: {
        taskIdParam: "task-1",
        sessionKeyParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "spec",
        selectionIntent: {
          taskId: "task-1",
          role: "planner",
          sessionIdentity: null,
        },
      },
      routeTaskId: "task-1",
      viewTaskId: "task-1",
    });

    expect(viewParams).toMatchObject({
      sessionKeyParam: null,
      sessionIdentity: null,
      hasExplicitRoleSelection: true,
      roleSelection: "planner",
      fallbackRole: "planner",
      keepExplicitRoleSessionless: true,
    });
  });
});
