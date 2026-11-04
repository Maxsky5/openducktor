import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import {
  workflowDefinitionSchema,
  repoConfigSchema,
  type WorkflowLaunchRequest,
} from "@openducktor/contracts";
import { prepareSessionStartInstruction } from "../../sessions/start/session-start-kickoff";
import { startSessionWorkflow } from "../../sessions/start/session-start-workflow";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createSettingsSnapshotFixture } from "../../test-support/shared-test-fixtures";
import { createTaskWorkflow, workflowRoleCatalog } from "@openducktor/workflows";
import { createHumanReviewFeedbackState } from "./human-review-feedback-state";
import { describe, expect, mock, test } from "bun:test";
import { createFeedbackFake } from "../../test-support/feedback-fake";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { createAgentSessionSummaryFixture } from "../../test-support/shared-test-fixtures";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import {
  type HumanReviewFeedbackStartRequest,
  HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE,
  submitHumanReviewFeedback,
} from "./human-review-feedback-flow";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

const createBuilderSession = (
  overrides: Parameters<typeof createAgentSessionSummaryFixture>[0] = {},
) =>
  createAgentSessionSummaryFixture({
    sessionAssociation: {
      kind: "workflow",
      workspaceId: "workspace-1",
      taskId: "TASK-1",
      role: "build",
    },

    ...overrides,
  });

const createState = (
  overrides: Partial<HumanReviewFeedbackState> = {},
): HumanReviewFeedbackState => ({
  launch: {
    role: "build",
    roleLabel: "Builder",
    launchActionId: "build_after_human_request_changes",
    postStartAction: "kickoff",
  },
  requestChanges: false,
  confirmLabel: "Request Changes",
  taskId: "TASK-1",
  message: "Apply the requested changes.",
  ...overrides,
});

const unexpectedRequestChanges = async (): Promise<never> => {
  throw new Error("A feedback launch must not request task changes.");
};

const STARTED_SESSION = {
  externalSessionId: "session-new",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
} satisfies AgentSessionIdentity;

describe("human-review-feedback-flow", () => {
  test.each([
    { kind: "kickoff", override: false },
    { kind: "message", override: false },
    { kind: "message", override: true },
  ] as const)(
    "renders collected feedback at the host request boundary %j",
    async ({ kind, override }) => {
      const { alpha: original, board } = createSharedBoardWorkflows();
      const definition = workflowDefinitionSchema.parse(original.definition);
      for (const step of definition.steps) {
        if (step.kind !== "agent") continue;
        for (const launch of step.launchActions) {
          if (launch.id === "alpha_write_revise") launch.template.kind = kind;
        }
      }
      const alpha = createTaskWorkflow(
        definition,
        original.workflowTemplates.map((template) =>
          template.id === "alpha.kickoff.write_revise"
            ? {
                ...template,
                purpose: kind,
                template: "Declared policy for {{task.id}}: {{humanFeedback}}",
              }
            : template,
        ),
        workflowRoleCatalog([original]),
      );
      const task = createWorkflowTaskCardFixture(alpha, board, {
        status: "alpha_work",
        artifactSummary: {
          ...alpha.emptyArtifactSummary(),
          alpha_review: { present: true, verdict: "revise" },
        },
      });
      const state = createHumanReviewFeedbackState([task], task.id, {
        kind: "launch",
        launchActionId: "alpha_write_revise",
      });
      expect(state.confirmLabel).toBe("alpha Revise");
      state.message = "Revise this draft.";
      const templateId = "alpha.kickoff.write_revise";
      const connection = createTestClientConnection({
        client: {
          workspaceGetRepoConfig: async () =>
            repoConfigSchema.parse({
              workspaceId: "workspace",
              workspaceName: "Workspace",
              repoPath: "/repo",
              promptOverrides: override
                ? {
                    [templateId]: {
                      enabled: true,
                      baseVersion: 1,
                      template: "Repo policy for {{task.id}}: {{humanFeedback}}",
                    },
                  }
                : {},
            }),
          workspaceGetSettingsSnapshot: async () =>
            createSettingsSnapshotFixture({
              globalPromptOverrides: override
                ? {
                    [templateId]: {
                      enabled: true,
                      baseVersion: 1,
                      template: "Global policy for {{task.id}}: {{humanFeedback}}",
                    },
                  }
                : {},
            }),
        },
      });
      try {
        const hostLaunch = mock(async (request: WorkflowLaunchRequest) => ({
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          taskId: request.taskId,
          role: state.launch!.role,
          status: "completed" as const,
          startMode: "fresh" as const,
          session: {
            ...STARTED_SESSION,
            startedAt: "2026-10-28T00:00:00.000Z",
            status: "idle" as const,
          },
        }));
        const start = mock(async (request: HumanReviewFeedbackStartRequest) =>
          startSessionWorkflow({
            request: await prepareSessionStartInstruction({
              queryClient: connection.queryClient,
              workspaceId: "workspace",
              task,
              request,
            }),
            decision: {
              startMode: "fresh",
              selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "model" },
            },
            workspaceId: "workspace",
            repoPath: "/repo",
            client: { agentSessionWorkflowLaunch: hostLaunch },
            sendAgentMessage: async () => null,
          }),
        );
        await submitHumanReviewFeedback({
          requestChangesTask: unexpectedRequestChanges,
          feedback: createFeedbackFake(),
          state,
          builderSessions: [],
          startRequestChangesSession: start,
        });
        expect(start).toHaveBeenCalledTimes(1);
        expect(start.mock.calls[0]?.[0]).toMatchObject({
          launchActionId: "alpha_write_revise",
          humanFeedback: "Revise this draft.",
          postStartAction: kind === "kickoff" ? "kickoff" : "send_message",
        });
        expect(start.mock.calls[0]?.[0]).not.toHaveProperty("beforeStartAction");
        if (kind === "message")
          expect(hostLaunch.mock.calls[0]?.[0].instruction).toEqual({
            kind: "message",
            parts: [
              {
                kind: "text",
                text: `${override ? "Repo" : "Declared"} policy for ${task.id}: Revise this draft.`,
              },
            ],
          });
        else
          expect(hostLaunch.mock.calls[0]?.[0].instruction).toEqual({
            kind: "kickoff",
            feedback: "Revise this draft.",
          });
      } finally {
        await connection.dispose();
      }
    },
  );

  test("submitHumanReviewFeedback rejects blank messages before starting the shared workflow", async () => {
    const feedback = createFeedbackFake();
    const startRequestChangesSession = mock(async () => STARTED_SESSION);

    const result = await submitHumanReviewFeedback({
      requestChangesTask: unexpectedRequestChanges,
      feedback,
      state: createState({ message: "   " }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(feedback.shownOf("error").map((entry) => entry.message)).toEqual([
      HUMAN_REVIEW_FEEDBACK_REQUIRED_MESSAGE,
    ]);
    expect(startRequestChangesSession).not.toHaveBeenCalled();
  });

  test("submitHumanReviewFeedback builds a kickoff-based shared start-session request", async () => {
    const startRequestChangesSession = mock(async () => STARTED_SESSION);
    const latestBuilderSession = createBuilderSession({
      externalSessionId: "builder-session-2",
      startedAt: "2026-03-20T12:00:00.000Z",
    });
    const previousBuilderSession = createBuilderSession({
      externalSessionId: "builder-session-1",
      startedAt: "2026-03-19T12:00:00.000Z",
    });
    const builderSessions = [latestBuilderSession, previousBuilderSession];

    const result = await submitHumanReviewFeedback({
      requestChangesTask: unexpectedRequestChanges,
      feedback: createFeedbackFake(),
      state: createState({ message: "  Use the standard request-changes workflow.  " }),
      builderSessions,
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "started" });
    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        initialSourceSession: {
          externalSessionId: "builder-session-2",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
        postStartAction: "kickoff",
        humanFeedback: "Use the standard request-changes workflow.",
      }),
    );
    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        existingSessionOptions: [
          expect.objectContaining({
            value: agentSessionIdentityKey(latestBuilderSession),
            sourceSession: {
              externalSessionId: "builder-session-2",
              runtimeKind: "opencode",
              workingDirectory: "/tmp/repo/worktree",
            },
          }),
          expect.objectContaining({
            value: agentSessionIdentityKey(previousBuilderSession),
            sourceSession: {
              externalSessionId: "builder-session-1",
              runtimeKind: "opencode",
              workingDirectory: "/tmp/repo/worktree",
            },
          }),
        ],
      }),
    );
  });

  test("submitHumanReviewFeedback defaults the shared start-session flow to fresh when no builder sessions exist", async () => {
    const startRequestChangesSession = mock(async () => STARTED_SESSION);

    await submitHumanReviewFeedback({
      requestChangesTask: unexpectedRequestChanges,
      feedback: createFeedbackFake(),
      state: createState({ message: "Start this in a new builder session." }),
      builderSessions: [],
      startRequestChangesSession,
    });

    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        initialStartMode: "fresh",
        existingSessionOptions: [],
      }),
    );
  });

  test("submitHumanReviewFeedback keeps the first modal editable when the shared workflow is cancelled", async () => {
    const startRequestChangesSession = mock(async () => undefined);

    const result = await submitHumanReviewFeedback({
      requestChangesTask: unexpectedRequestChanges,
      feedback: createFeedbackFake(),
      state: createState({ message: "Keep editing if I cancel the second step." }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(startRequestChangesSession).toHaveBeenCalledTimes(1);
  });

  test("submitHumanReviewFeedback preserves the human-request-changes launch action in the handoff request", async () => {
    const startRequestChangesSession = mock(async () => STARTED_SESSION);

    await submitHumanReviewFeedback({
      requestChangesTask: unexpectedRequestChanges,
      feedback: createFeedbackFake(),
      state: createState({
        message: "Address the requested changes in the shared flow.",
      }),
      builderSessions: [createBuilderSession({ externalSessionId: "builder-session-1" })],
      startRequestChangesSession,
    });

    expect(startRequestChangesSession).toHaveBeenCalledWith(
      expect.objectContaining({
        launchActionId: "build_after_human_request_changes",
        humanFeedback: "Address the requested changes in the shared flow.",
      }),
    );
  });
});
