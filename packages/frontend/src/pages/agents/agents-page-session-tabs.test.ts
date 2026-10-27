import {
  BUILTIN_ROLE_LABELS,
  resolveSessionContinuationLaunchAction,
} from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import { buildTask } from "@/components/features/agents/agent-chat/agent-chat-test-fixtures";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { toAgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
} from "@/test-utils/shared-test-fixtures";
import { buildRoleEnabledMapForTask } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import {
  type AgentSessionWorkflowSummary,
  buildLatestSessionByRoleMap,
  buildLatestSessionByTaskMap,
  buildLiveSessionByRoleMap,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
  buildWorkflowStateByRole,
} from "./agents-page-session-tabs";

const buildSession = (
  overrides: AgentSessionFixtureOverrides = {},
): AgentSessionWorkflowSummary => {
  const session = createAgentSessionFixture(
    {
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },

      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-02-20T10:00:00.000Z",
      workingDirectory: "/tmp/work",
      historyLoadState: overrides.historyLoadState ?? "not_requested",
    },
    overrides,
  );
  const summary = toAgentSessionSummary(session);
  if (summary.role === null) {
    throw new Error("Workflow summary fixtures require a role.");
  }
  return summary;
};

describe("agents-page-session-tabs", () => {
  test("selects latest session per task", () => {
    const map = buildLatestSessionByTaskMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "older",
        startedAt: "2026-02-20T09:00:00.000Z",
      }),
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "newer",
        startedAt: "2026-02-20T11:00:00.000Z",
      }),
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-2", role: "spec" },
        externalSessionId: "task-2-session",
      }),
    ]);

    expect(map.get("task-1")?.externalSessionId).toBe("newer");
    expect(map.get("task-2")?.externalSessionId).toBe("task-2-session");
  });

  test("uses deterministic tiebreaker when timestamps are equal", () => {
    const map = buildLatestSessionByTaskMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "first",
        startedAt: "2026-02-20T10:00:00.000Z",
      }),
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "second",
        startedAt: "2026-02-20T10:00:00.000Z",
      }),
    ]);

    expect(map.get("task-1")?.externalSessionId).toBe("second");
  });

  test("builds role enablement from backend workflow payload", () => {
    const task = buildTask({
      issueType: "feature",
      status: "spec_ready",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    expect(buildRoleEnabledMapForTask(task)).toEqual({
      spec: true,
      planner: true,
      build: false,
      qa: false,
    });

    const aiReviewTask = buildTask({
      issueType: "feature",
      status: "ai_review",
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
    expect(buildRoleEnabledMapForTask(aiReviewTask)).toEqual({
      spec: true,
      planner: true,
      build: true,
      qa: true,
    });
  });

  test("builds workflow rail states from backend-provided workflow fields", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states).toEqual({
      spec: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "none",
      },
      planner: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "none",
      },
      build: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      qa: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
    });
  });

  test("renders skippable available steps as optional", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.spec).toEqual({
      tone: "optional",
      availability: "optional",
      completion: "not_started",
      liveSession: "none",
    });
    expect(states.qa.availability).toBe("blocked");
  });

  test.each([
    ["running", "none", "available", "not_started"],
    ["idle", "none", "available", "not_started"],
    ["waiting_input", "waiting_input", "waiting_input", "in_progress"],
    ["error", "error", "failed", "in_progress"],
  ] as const)(
    "keeps unavailable %s activity out of workflow overrides",
    (activityState, liveSession, tone, completion) => {
      const task = buildTask();
      const states = buildWorkflowStateByRole({
        task,
        roleWorkflowsByTask: {
          spec: { required: true, canSkip: false, available: true, completed: true },
          planner: task.agentWorkflows.planner,
          build: { required: true, canSkip: false, available: true, completed: false },
          qa: task.agentWorkflows.qa,
        },
        liveSessionByRole: buildLiveSessionByRoleMap([
          {
            ...buildSession({
              sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
            }),
            activityState,
            statusUnavailableReason: "Update Claude Code and reconnect the runtime.",
          },
        ]),
      });
      expect(states.build).toEqual({ availability: "available", completion, liveSession, tone });
      expect(states.spec.completion).toBe("done");
    },
  );

  test("does not mark builder as in_progress when stopped session exists but builder is not available", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "stopped",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.build).toEqual({
      tone: "blocked",
      availability: "blocked",
      completion: "not_started",
      liveSession: "stopped",
    });
  });

  test("marks builder as in_progress when builder session exists but is stopped without build_completed", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "stopped",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.build).toEqual({
      tone: "in_progress",
      availability: "available",
      completion: "in_progress",
      liveSession: "stopped",
    });
  });

  test("uses warning tone for blocked builder tasks even when the latest session is stopped", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "stopped",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: buildTask({ status: "blocked" }),
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.build).toEqual({
      tone: "waiting_input",
      availability: "available",
      completion: "in_progress",
      liveSession: "stopped",
    });
    expect(states.spec.tone).toBe("done");
    expect(states.planner.tone).toBe("done");
    expect(states.qa.tone).toBe("blocked");
  });

  test("uses warning tone for blocked builder tasks without an existing builder session", () => {
    const states = buildWorkflowStateByRole({
      task: buildTask({ status: "blocked" }),
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole: buildLiveSessionByRoleMap([]),
    });

    expect(states.build).toEqual({
      tone: "waiting_input",
      availability: "available",
      completion: "not_started",
      liveSession: "none",
    });
  });

  test("keeps blocked builder tasks in progress while the live builder session is still running", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "running",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: buildTask({ status: "blocked" }),
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.build).toEqual({
      tone: "in_progress",
      availability: "available",
      completion: "in_progress",
      liveSession: "running",
    });
  });

  test("keeps blocked builder tasks failed when the latest builder session errored", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        status: "error",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: buildTask({ status: "blocked" }),
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states.build).toEqual({
      tone: "failed",
      availability: "available",
      completion: "in_progress",
      liveSession: "error",
    });
  });

  test("marks workflow role as in_progress when latest role session is started but not completed", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
        status: "idle",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states).toEqual({
      spec: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      planner: {
        tone: "in_progress",
        availability: "available",
        completion: "in_progress",
        liveSession: "idle",
      },
      build: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      qa: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
    });
  });

  test("keeps workflow role in_progress while the latest role session is still running even if workflow is completed", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        status: "running",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states).toEqual({
      spec: {
        tone: "in_progress",
        availability: "available",
        completion: "done",
        liveSession: "running",
      },
      planner: {
        tone: "available",
        availability: "available",
        completion: "not_started",
        liveSession: "none",
      },
      build: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      qa: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
    });
  });

  test("does not mark unavailable roles as in_progress when a session exists", () => {
    const liveSessionByRole = buildLiveSessionByRoleMap([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
        status: "idle",
      }),
    ]);
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: false, completed: false },
        planner: { required: true, canSkip: false, available: false, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole,
    });

    expect(states).toEqual({
      spec: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      planner: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      build: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "none",
      },
      qa: {
        tone: "blocked",
        availability: "blocked",
        completion: "not_started",
        liveSession: "idle",
      },
    });
  });

  test("marks qa step as rejected when task is back in progress after qa rejection", () => {
    const task = buildTask({
      issueType: "feature",
      status: "in_progress",
      artifactSummary: {
        spec: { present: true, updatedAt: "2026-02-22T08:00:00.000Z" },
        plan: { present: true, updatedAt: "2026-02-22T08:10:00.000Z" },
        qaReport: { present: true, updatedAt: "2026-02-22T08:20:00.000Z", verdict: "rejected" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
    });
    const states = buildWorkflowStateByRole({
      task,
      roleWorkflowsByTask: {
        spec: task.agentWorkflows.spec,
        planner: task.agentWorkflows.planner,
        build: task.agentWorkflows.build,
        qa: task.agentWorkflows.qa,
      },
      liveSessionByRole: buildLiveSessionByRoleMap([
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
          status: "idle",
        }),
      ]),
    });

    expect(states).toEqual({
      spec: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "none",
      },
      planner: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "none",
      },
      build: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "none",
      },
      qa: {
        tone: "rejected",
        availability: "blocked",
        completion: "rejected",
        liveSession: "idle",
      },
    });
  });

  describe.each(["ai_review", "blocked"] as const)("QA retry in %s", (taskStatus) => {
    test.each([
      { activity: "starting", status: "starting", tone: "in_progress", completion: "in_progress" },
      { activity: "running", status: "running", tone: "in_progress", completion: "in_progress" },
      {
        activity: "waiting_input",
        status: "running",
        tone: "waiting_input",
        completion: "in_progress",
      },
      { activity: "error", status: "error", tone: "failed", completion: "in_progress" },
      { activity: "idle", status: "idle", tone: "rejected", completion: "rejected" },
      { activity: "stopped", status: "stopped", tone: "rejected", completion: "rejected" },
    ] as const)(
      "shows $tone for a $activity QA session",
      ({ activity, status, tone, completion }) => {
        const task = buildTask({
          issueType: "feature",
          status: taskStatus,
          artifactSummary: {
            spec: { present: true, updatedAt: "2026-02-22T08:00:00.000Z" },
            plan: { present: true, updatedAt: "2026-02-22T08:10:00.000Z" },
            qaReport: { present: true, updatedAt: "2026-02-22T08:20:00.000Z", verdict: "rejected" },
          },
          agentWorkflows: {
            spec: { required: true, canSkip: false, available: true, completed: true },
            planner: { required: true, canSkip: false, available: true, completed: true },
            build: {
              required: true,
              canSkip: false,
              available: true,
              completed: taskStatus === "ai_review",
            },
            qa: { required: true, canSkip: false, available: true, completed: false },
          },
        });
        const savedTask = structuredClone(task);
        const qaSession = buildSession({
          sessionAssociation: { kind: "workflow", taskId: task.id, role: "qa" },
          status,
          pendingQuestions:
            activity === "waiting_input" ? [{ requestId: "q-1", questions: [] }] : [],
        });

        const states = buildWorkflowStateByRole({
          task,
          roleWorkflowsByTask: {
            spec: task.agentWorkflows.spec,
            planner: task.agentWorkflows.planner,
            build: task.agentWorkflows.build,
            qa: task.agentWorkflows.qa,
          },
          liveSessionByRole: buildLiveSessionByRoleMap([qaSession]),
        });

        expect(states.qa).toEqual({
          tone,
          availability: "available",
          completion,
          liveSession: activity,
        });
        expect(task).toEqual(savedTask);
      },
    );
  });

  test("does not mark builder done from stale approved qa report after build reopens", () => {
    const task = buildTask({
      status: "in_progress",
      artifactSummary: {
        spec: { present: true, updatedAt: "2026-02-22T09:00:00.000Z" },
        plan: { present: true, updatedAt: "2026-02-22T09:30:00.000Z" },
        qaReport: { present: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "approved" },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: true },
      },
    });

    const states = buildWorkflowStateByRole({
      task,
      roleWorkflowsByTask: {
        spec: task.agentWorkflows.spec,
        planner: task.agentWorkflows.planner,
        build: task.agentWorkflows.build,
        qa: task.agentWorkflows.qa,
      },
      liveSessionByRole: buildLiveSessionByRoleMap([
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
          status: "idle",
        }),
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
          status: "idle",
        }),
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
          status: "stopped",
          startedAt: "2026-02-22T11:00:00.000Z",
        }),
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
          status: "idle",
          startedAt: "2026-02-22T10:00:00.000Z",
        }),
      ]),
    });

    expect(states).toEqual({
      spec: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "idle",
      },
      planner: {
        tone: "done",
        availability: "available",
        completion: "done",
        liveSession: "idle",
      },
      build: {
        tone: "in_progress",
        availability: "available",
        completion: "in_progress",
        liveSession: "stopped",
      },
      qa: {
        tone: "done",
        availability: "blocked",
        completion: "done",
        liveSession: "idle",
      },
    });
  });

  test("marks builder done for approved qa in build-complete task statuses", () => {
    const task = buildTask({
      status: "human_review",
      artifactSummary: {
        spec: { present: true, updatedAt: "2026-02-22T09:00:00.000Z" },
        plan: { present: true, updatedAt: "2026-02-22T09:30:00.000Z" },
        qaReport: { present: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "approved" },
      },
      // The host completes the Builder step in every status after build completion.
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        build: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: true },
      },
    });

    const states = buildWorkflowStateByRole({
      task,
      roleWorkflowsByTask: {
        spec: task.agentWorkflows.spec,
        planner: task.agentWorkflows.planner,
        build: task.agentWorkflows.build,
        qa: task.agentWorkflows.qa,
      },
      liveSessionByRole: buildLiveSessionByRoleMap([]),
    });

    expect(states.build.completion).toBe("done");
    expect(states.build.tone).toBe("done");
  });

  test("keeps the newest role session as the workflow target even when an older one is waiting", () => {
    const sessions = [
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "session-newer",
        startedAt: "2026-02-22T11:00:00.000Z",
        status: "idle",
      }),
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        externalSessionId: "session-waiting",
        startedAt: "2026-02-22T10:00:00.000Z",
        status: "running",
        pendingQuestions: [{ requestId: "q-1", questions: [] }],
      }),
    ];
    const latestSessionByRole = buildLatestSessionByRoleMap(sessions);
    const liveSessionByRole = buildLiveSessionByRoleMap(sessions);

    expect(latestSessionByRole.spec?.externalSessionId).toBe("session-newer");
    expect(liveSessionByRole.spec).toBe("idle");
  });

  test("marks optional available roles as optional instead of generic available", () => {
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        build: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: true, completed: false },
      },
      liveSessionByRole: buildLiveSessionByRoleMap([]),
    });

    expect(states.spec.tone).toBe("optional");
    expect(states.planner.tone).toBe("optional");
    expect(states.qa.tone).toBe("optional");
    expect(states.build.tone).toBe("available");
  });

  test("surfaces waiting-input and failed lane tones from role sessions", () => {
    const states = buildWorkflowStateByRole({
      task: null,
      roleWorkflowsByTask: {
        spec: { required: true, canSkip: false, available: true, completed: false },
        planner: { required: true, canSkip: false, available: true, completed: false },
        build: { required: true, canSkip: false, available: false, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
      liveSessionByRole: buildLiveSessionByRoleMap([
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
          status: "running",
          pendingApprovals: [
            {
              requestId: "p-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"bash"}`,
              summary: `Approval request for ${"bash"}.`,
              affectedPaths: [],
              action: { name: "bash" },
              mutation: "mutating" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
        }),
        buildSession({
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
          status: "error",
        }),
      ]),
    });

    expect(states.spec.tone).toBe("waiting_input");
    expect(states.spec.liveSession).toBe("waiting_input");
    expect(states.planner.tone).toBe("failed");
    expect(states.planner.liveSession).toBe("error");
  });

  test("builds grouped session selector options", () => {
    const specSessionOne = buildSession({
      runtimeKind: "opencode",
      externalSessionId: "spec-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      startedAt: "2026-02-22T09:20:00.000Z",
    });
    const specSessionTwo = buildSession({
      runtimeKind: "opencode",
      externalSessionId: "spec-2",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      startedAt: "2026-02-22T08:20:00.000Z",
    });
    const plannerSession = buildSession({
      runtimeKind: "opencode",
      externalSessionId: "planner-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
      startedAt: "2026-02-22T10:20:00.000Z",
    });
    const groups = buildSessionSelectorGroups({
      sessionsForTask: [specSessionOne, specSessionTwo, plannerSession],
      roleLabelByRole: { ...BUILTIN_ROLE_LABELS },
    });

    expect(groups[0]?.label).toBe("Spec");
    expect(groups[0]?.options[0]?.value).toBe(agentSessionIdentityKey(specSessionOne));
    expect(groups[0]?.options[0]?.label).toBe("Spec #2");
    expect(groups[0]?.options[1]?.value).toBe(agentSessionIdentityKey(specSessionTwo));
    expect(groups[0]?.options[1]?.label).toBe("Spec #1");
    expect(groups[0]?.options[0]?.secondaryLabel).toBeUndefined();
    expect(groups[1]?.label).toBe("Planner");
    expect(groups[1]?.options[0]?.value).toBe(agentSessionIdentityKey(plannerSession));
    expect(groups[1]?.options[0]?.label).toBe("Planner #1");
  });

  test("builds latest session map by role", () => {
    const sessions = [
      buildSession({
        externalSessionId: "spec-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        startedAt: "2026-02-20T08:00:00.000Z",
      }),
      buildSession({
        runtimeKind: "opencode",
        externalSessionId: "planner-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
        startedAt: "2026-02-20T10:00:00.000Z",
      }),
      buildSession({
        externalSessionId: "build-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        startedAt: "2026-02-20T09:00:00.000Z",
      }),
    ];

    const latestByRole = buildLatestSessionByRoleMap(sessions);
    expect(latestByRole.spec?.externalSessionId).toBe("spec-1");
    expect(latestByRole.planner?.externalSessionId).toBe("planner-1");
    expect(latestByRole.build?.externalSessionId).toBe("build-1");
    expect(latestByRole.qa).toBeNull();
  });

  test("builds latest session map by role using newest startedAt", () => {
    const sessions = [
      buildSession({
        externalSessionId: "build-older",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        startedAt: "2026-02-20T09:00:00.000Z",
      }),
      buildSession({
        externalSessionId: "build-newer",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        startedAt: "2026-02-20T11:00:00.000Z",
      }),
    ];

    const latestByRole = buildLatestSessionByRoleMap(sessions);

    expect(latestByRole.build?.externalSessionId).toBe("build-newer");
  });
});

describe("buildSessionCreateOptions", () => {
  const qaRejectedTask = buildTask({
    status: "in_progress",
    artifactSummary: {
      spec: { present: true },
      plan: { present: true },
      qaReport: { present: true, verdict: "rejected" },
    },
  });

  test("builds one message-first option for each available role", () => {
    const options = buildSessionCreateOptions({
      task: qaRejectedTask,
      roleEnabledByTask: { spec: false, planner: true, build: true, qa: false },
      createSessionDisabled: false,
      roleLabelByRole: { ...BUILTIN_ROLE_LABELS },
    });

    expect(options.map((option) => option.id)).toEqual([
      "planner:planner_initial:message_first",
      "build:build_after_qa_rejected:message_first",
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Prepare Planner session",
      "Prepare Builder session",
    ]);
    expect(
      options.every((option) => option.description.includes("without sending a kickoff")),
    ).toBe(true);
  });

  test("uses the continuation launch action of each role", () => {
    for (const task of [qaRejectedTask, buildTask({ status: "human_review" })]) {
      for (const option of buildSessionCreateOptions({
        task,
        roleEnabledByTask: { spec: true, planner: true, build: true, qa: true },
        createSessionDisabled: false,
        roleLabelByRole: { ...BUILTIN_ROLE_LABELS },
      })) {
        expect(option.launchActionId).toBe(
          resolveSessionContinuationLaunchAction(option.role, task),
        );
      }
    }
  });

  test("keeps role order and disables options while a session is working", () => {
    const options = buildSessionCreateOptions({
      task: buildTask({ status: "human_review" }),
      roleEnabledByTask: { spec: true, planner: true, build: true, qa: true },
      createSessionDisabled: true,
      roleLabelByRole: { ...BUILTIN_ROLE_LABELS },
    });

    expect(options.map((option) => option.launchActionId)).toEqual([
      "spec_initial",
      "planner_initial",
      "build_after_human_request_changes",
      "qa_review",
    ]);
    for (const option of options) {
      expect(option.disabled).toBe(true);
      expect(option.disabledReason).toBe("Wait for the current session to finish.");
    }
  });
});
