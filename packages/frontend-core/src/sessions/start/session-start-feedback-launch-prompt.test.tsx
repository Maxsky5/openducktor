import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { workflowDefinitionSchema, type WorkflowLaunchRequest } from "@openducktor/contracts";
import {
  createTaskWorkflow,
  resolveWorkflowBoard,
  type ResolvedTaskCard,
} from "@openducktor/workflows";
import {
  createWorkflowTaskCardFixture,
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { workspaceQueryKeys } from "../../queries/workspace";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createRuntimeHookHarness } from "../../test-support/runtime-hook-harness";
import { createSettingsSnapshotFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { prepareSessionStartInstruction } from "./session-start-kickoff";
import type { SessionStartFlowRequest } from "./session-start-types";
import { startSessionWorkflow } from "./session-start-workflow";
import { useSessionStartKickoffDraft } from "./use-session-start-kickoff-draft";
import { useSessionStartKickoffPrompt } from "./use-session-start-kickoff-prompt";

/** A review task in approval. Request rewrite moves it to writing and starts the feedback launch. */
const approvalTask = (kind: "kickoff" | "message"): ResolvedTaskCard => {
  const definition = workflowDefinitionSchema.parse(reviewTaskDefinition());
  for (const step of definition.steps) {
    if (step.kind !== "agent") continue;
    for (const launch of step.launchActions)
      if (launch.id === "write_feedback") launch.template.kind = kind;
  }
  const workflow = createTaskWorkflow(
    definition,
    reviewTaskPromptTemplates.map((template) =>
      template.id === "messages.write_feedback"
        ? {
            ...template,
            purpose: kind,
            template: "Task status: {{task.status}}. {{humanFeedback}}",
          }
        : template,
    ),
    reviewTaskRoles,
  );
  const board = resolveWorkflowBoard(
    { states: workflow.definition.states.map(({ id }) => ({ id, taskOrder: "updated" })) },
    [workflow],
  );
  return createWorkflowTaskCardFixture(workflow, board, {
    issueType: "feature",
    status: "approval",
  });
};

const feedbackRequest = (
  task: ResolvedTaskCard,
  postStartAction: SessionStartFlowRequest["postStartAction"],
): SessionStartFlowRequest => ({
  taskId: task.id,
  role: "writer",
  launchActionId: "write_feedback",
  postStartAction,
  humanFeedback: "Shorten the intro.",
  beforeStartAction: { eventId: "request-rewrite" },
});

const connectionFor = () => {
  const connection = createTestClientConnection({
    client: {
      workspaceGetRepoConfig: async () =>
        repoConfigFixture({ workspaceId: "a", workspaceName: "a", repoPath: "/a" }),
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    },
  });
  connection.queryClient.setQueryData(
    workspaceQueryKeys.repoConfig("a"),
    repoConfigFixture({ workspaceId: "a", workspaceName: "a", repoPath: "/a" }),
  );
  connection.queryClient.setQueryData(
    workspaceQueryKeys.settingsSnapshot(),
    createSettingsSnapshotFixture(),
  );
  return connection;
};

/** Starts the launch and returns the instruction that the host request carries. */
const hostInstruction = async (request: SessionStartFlowRequest, kickoffPrompt?: string) => {
  const hostLaunch = mock(async (launch: WorkflowLaunchRequest) => ({
    workspaceId: launch.workspaceId,
    repoPath: launch.repoPath,
    taskId: launch.taskId,
    role: request.role,
    status: "completed" as const,
    startMode: "fresh" as const,
    session: {
      externalSessionId: "session-new",
      runtimeKind: "opencode" as const,
      workingDirectory: "/a/worktree",
      startedAt: "2026-10-28T00:00:00.000Z",
      status: "idle" as const,
    },
  }));
  const decision: Parameters<typeof startSessionWorkflow>[0]["decision"] = {
    startMode: "fresh",
    selectedModel: { runtimeKind: "opencode", providerId: "openai", modelId: "model" },
  };
  if (kickoffPrompt !== undefined) decision.kickoffPrompt = kickoffPrompt;
  await startSessionWorkflow({
    request,
    decision,
    workspaceId: "a",
    repoPath: "/a",
    client: { agentSessionWorkflowLaunch: hostLaunch },
    sendAgentMessage: async () => null,
  });
  const launch = hostLaunch.mock.calls[0]?.[0];
  expect(launch?.beforeStartAction).toEqual({ eventId: "request-rewrite" });
  return launch?.instruction;
};

describe("a feedback launch that follows an event", () => {
  test("sends the untouched kickoff preview of the desktop and mobile start forms with the state that the event reaches", async () => {
    const task = approvalTask("kickoff");
    const request = feedbackRequest(task, "kickoff");
    const props = {
      kickoff: { workspaceId: "a", task, request },
      selectedTargetBranch: "",
    };
    const harness = createRuntimeHookHarness(
      (input: typeof props) => {
        const { kickoffPrompt } = useSessionStartKickoffPrompt(input);
        // Both start forms send the draft value. With customization off, it is the preview.
        return useSessionStartKickoffDraft({
          requestId: "start-1",
          open: true,
          prompt: kickoffPrompt,
        }).value;
      },
      props,
      { connection: connectionFor(), seedSettingsSnapshot: false },
    );
    try {
      await harness.mount();
      const kickoffPrompt = harness.getLatest();
      expect(kickoffPrompt).toBe("Task status: writing. Shorten the intro.");

      expect(await hostInstruction(request, kickoffPrompt)).toEqual({
        kind: "kickoff",
        text: "Task status: writing. Shorten the intro.",
        feedback: "Shorten the intro.",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("sends the message template with the state that the event reaches", async () => {
    const task = approvalTask("message");
    const connection = connectionFor();
    try {
      const request = await prepareSessionStartInstruction({
        queryClient: connection.queryClient,
        workspaceId: "a",
        task,
        request: feedbackRequest(task, "send_message"),
      });

      expect(await hostInstruction(request)).toEqual({
        kind: "message",
        parts: [{ kind: "text", text: "Task status: writing. Shorten the intro." }],
      });
    } finally {
      await connection.dispose();
    }
  });
});
