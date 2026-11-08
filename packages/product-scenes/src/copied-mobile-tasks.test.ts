import { describe, expect, test } from "bun:test";
import { APPROVAL_MODES, APPROVAL_TEXT, MERGE_METHODS } from "./replicas/mobile/ApproveSheet";
import { PHONE_LANES } from "./replicas/mobile/LaneSwitcher";
import { START_SHEET_TEXT } from "./replicas/mobile/StartSessionSheet";
import {
  BRANCH,
  DONE,
  QUICK_ACTIONS,
  REMOTE_BRANCH,
  SQUASH_HINT,
} from "./scenes/mobile-approve/sample";
import { CARDS } from "./scenes/mobile-start-builder/sample";
import { importProduct } from "./test-support/product-source";

type TaskCard = {
  id: string;
  availableActions: string[];
  taskWorkflow: {
    definition: {
      states: { id: string; label: string; title?: string; shortLabel?: string; tone?: string }[];
    };
  };
};
type ArtifactState = { present: boolean; verdict?: string };
type TaskOverrides = {
  id: string;
  issueType: string;
  status: string;
  artifactSummary: Record<string, ArtifactState>;
};
type TaskFixture = (overrides: TaskOverrides) => TaskCard;
type GitProviderContext = { descriptor: { capabilities: { supportsPullRequests: boolean } } };
type BuilderSession = {
  externalSessionId: string;
  runtimeKind: string;
  taskId: string;
  role: string;
  status: string;
  startedAt: string;
  sessionAssociation: { kind: string; workspaceId: string; taskId: string; role: string };
};
type QuickActionParams = {
  selectedTask: TaskCard;
  sessionsForTask: readonly BuilderSession[];
  roleEnabledByTask: Record<string, boolean>;
  createSessionDisabled: boolean;
  gitProviderContext: GitProviderContext;
};
type QuickAction = { id: string; label: string; disabled: boolean };
type PublishTarget = { branch: string; remote: string };

// SAFETY: the test support of the workflows exports these fixtures.
const workflowSupport = await importProduct<{
  createTaskCardFixture: TaskFixture;
  emptyArtifactSummary: () => Record<string, { present: boolean }>;
}>("packages/workflows/test-support/index.ts");
// SAFETY: the workflows package exports the action labels.
const workflows = await importProduct<{
  taskActionLabel: (action: string, task: TaskCard) => string;
}>("packages/workflows/src/index.ts");
// SAFETY: task-action-presentation.ts exports the tone of an action.
const { taskActionTone } = await importProduct<{
  taskActionTone: (action: string, task: TaskCard) => string;
}>("packages/frontend-core/src/tasks/board/task-action-presentation.ts");
// SAFETY: agent-studio-quick-actions.ts exports these functions.
const quick = await importProduct<{
  buildAgentStudioQuickActions: (params: QuickActionParams) => QuickAction[];
  buildRoleEnabledMapForTask: (task: TaskCard) => Record<string, boolean>;
}>("packages/frontend-core/src/sessions/start/agent-studio-quick-actions.ts");
// SAFETY: the shared test fixtures export the Git provider context.
const { createGitProviderContextFixture } = await importProduct<{
  createGitProviderContextFixture: () => GitProviderContext;
}>("packages/frontend-core/src/test-support/shared-test-fixtures.ts");
// SAFETY: use-session-start-modal-coordinator.ts exports these functions.
const start = await importProduct<{
  buildSessionStartModalTitle: (role: string, workflow: TaskCard["taskWorkflow"]) => string;
  buildSessionStartModalDescription: (args: {
    launchActionId: string;
    taskWorkflow: TaskCard["taskWorkflow"];
  }) => string;
}>("packages/frontend-core/src/sessions/start/use-session-start-modal-coordinator.ts");
// SAFETY: task-approval-copy.ts exports these values.
const approval = await importProduct<{
  TASK_APPROVAL_MODE_OPTIONS: readonly { value: string; label: string }[];
  TASK_APPROVAL_MERGE_METHOD_OPTIONS: readonly {
    value: string;
    label: string;
    description: string;
  }[];
  TASK_APPROVAL_COPY: Record<string, string>;
  taskApprovalSquashCommitHint: (target: { branch: string }) => typeof SQUASH_HINT;
  directMergeCompletionButtonLabel: (model: {
    isSubmitting: boolean;
    publishTarget: PublishTarget;
  }) => string;
}>("packages/frontend-core/src/tasks/approval/task-approval-copy.ts");
// SAFETY: target-branch.ts exports this function.
const { canonicalTargetBranch } = await importProduct<{
  canonicalTargetBranch: (target: PublishTarget) => string;
}>("packages/frontend-core/src/lib/target-branch.ts");

/** A task of the built-in workflow in `status` whose spec, plan, and QA report are present. */
const taskIn = (status: string): TaskCard => {
  const artifacts: Record<string, ArtifactState> = {};
  for (const code of Object.keys(workflowSupport.emptyArtifactSummary())) {
    const state: ArtifactState = { present: true };
    if (code === "qaReport") state.verdict = "approved";
    artifacts[code] = state;
  }
  return workflowSupport.createTaskCardFixture({
    id: "fieldnotes-k3x9",
    issueType: "feature",
    status,
    artifactSummary: artifacts,
  });
};

describe("the task screens of the mobile app copied in the replicas", () => {
  test("the lane switcher shows the states of the built-in workflow in board order", () => {
    const { states } = taskIn("open").taskWorkflow.definition;
    const lanes = states.map((state) => ({
      id: state.id,
      title: state.title ?? state.label,
      shortLabel: state.shortLabel ?? state.label,
      tone: state.tone ?? "neutral",
    }));
    expect(lanes).toEqual(
      PHONE_LANES.map(({ id, title, shortLabel, tone }) => ({ id, title, shortLabel, tone })),
    );
  });

  test("the Ready for Dev cards offer Start Builder as the violet next step", () => {
    const task = taskIn("ready_for_dev");
    expect(workflows.taskActionLabel("build_start", task)).toBe("Start Builder");
    expect(taskActionTone("build_start", task)).toBe("prominent");
    for (const card of CARDS.ready_for_dev) expect(card.start.appearance).toBe("filled");
    const backlog = taskIn("open");
    expect(workflows.taskActionLabel("set_spec", backlog)).toBe(CARDS.open[0].start.label);
    expect(taskActionTone("set_spec", backlog)).toBe("neutral");
  });

  test("the start sheet of the Builder has the title and the lead of the app", () => {
    const { taskWorkflow } = taskIn("ready_for_dev");
    expect(start.buildSessionStartModalTitle("build", taskWorkflow)).toBe("Start Builder session");
    expect(
      start.buildSessionStartModalDescription({
        launchActionId: "build_implementation_start",
        taskWorkflow,
      }),
    ).toBe(START_SHEET_TEXT.freshLead);
  });

  test("Quick Actions lists the actions of a task in Human Review", () => {
    const task = taskIn("human_review");
    const builder: BuilderSession = {
      externalSessionId: "builder-1",
      runtimeKind: "codex",
      taskId: task.id,
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T12:00:00.000Z",
      sessionAssociation: { kind: "workflow", workspaceId: "w", taskId: task.id, role: "build" },
    };
    const options = quick.buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [builder],
      roleEnabledByTask: quick.buildRoleEnabledMapForTask(task),
      createSessionDisabled: false,
      gitProviderContext: createGitProviderContextFixture(),
    });
    expect(QUICK_ACTIONS.map(({ id, title }) => ({ id, title }))).toEqual(
      options.map(({ id, label }) => ({ id, title: label })),
    );
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  test("the approval sheet shows the choices and the text of the app", () => {
    expect(approval.TASK_APPROVAL_MODE_OPTIONS).toEqual(APPROVAL_MODES);
    expect(approval.TASK_APPROVAL_MERGE_METHOD_OPTIONS).toEqual(MERGE_METHODS);
    const copy = approval.TASK_APPROVAL_COPY;
    expect(copy.approvalActionLabel).toBe(APPROVAL_TEXT.approvalAction);
    expect(copy.mergeMethodLabel).toBe(APPROVAL_TEXT.mergeMethod);
    expect(copy.squashCommitMessageLabel).toBe(APPROVAL_TEXT.squashMessage);
    expect(copy.pullRequestDraftLabel).toBe(APPROVAL_TEXT.pullRequestDraft);
    expect(copy.localMergeReadyTitle).toBe(APPROVAL_TEXT.localMergeReady);
    expect(copy.nextStepTitle).toBe(APPROVAL_TEXT.nextStep);
    expect(copy.localBranchLabel).toBe(APPROVAL_TEXT.localBranch);
    expect(copy.remoteToUpdateLabel).toBe(APPROVAL_TEXT.pushTo);
    expect(copy.finishLater).toBe(APPROVAL_TEXT.finishLater);
    expect(SQUASH_HINT).toEqual(approval.taskApprovalSquashCommitHint({ branch: BRANCH }));
  });

  test("the publish step pushes the target branch and names it in the toast", () => {
    const publishTarget = { branch: BRANCH, remote: "origin" };
    expect(approval.directMergeCompletionButtonLabel({ isSubmitting: false, publishTarget })).toBe(
      `Push ${BRANCH} and mark done`,
    );
    expect(canonicalTargetBranch(publishTarget)).toBe(REMOTE_BRANCH);
    expect(DONE.description).toBe(REMOTE_BRANCH);
  });
});
