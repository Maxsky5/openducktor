import { describe, expect, test } from "bun:test";
import { ExternalLink, GitPullRequest, MessageSquare } from "lucide-react";
import {
  APPROVAL_TEXT,
  ASKED_DRAFT,
  chooseSessionLabel,
  pullRequestDraftOptions,
  pullRequestNotice,
} from "./replicas/mobile/ApproveSheet";
import { HUMAN_REVIEW_ACTIONS } from "./replicas/mobile/review-actions";
import { START_MODE_LABELS, START_SHEET_TEXT } from "./replicas/mobile/StartSessionSheet";
import { pullRequestName, WORKFLOW_RUNNING_LABEL } from "./replicas/mobile/WorkflowToolCard";
import { taskId } from "./sample/workspace";
import {
  PULL_REQUEST,
  SET_PULL_REQUEST,
  START_MODES,
  TASK,
} from "./scenes/mobile-pull-request/sample";
import { lucideName } from "./test-support/lucide-name";
import { importProduct, readProduct, readProductWords } from "./test-support/product-source";
import { reviewTask, type TaskCard, type TaskWorkflow } from "./test-support/review-task";
type BuilderSession = {
  externalSessionId: string;
  runtimeKind: string;
  workingDirectory: string;
  taskId: string;
  role: string;
  startedAt: string;
  activityState: string;
  selectedModel: null;
};
type SessionOption = { label: string; secondaryLabel?: string };
/** A session of the task as Quick Actions read it. */
type QuickSession = {
  externalSessionId: string;
  runtimeKind: string;
  taskId: string;
  role: string;
  status: string;
  startedAt: string;
  sessionAssociation: { kind: string; workspaceId: string; taskId: string; role: string };
};
type GitProviderContext = { descriptor: { capabilities: { supportsPullRequests: boolean } } };
type DraftOption = { value: "manual" | "generate_ai"; label: string; description: string };
/** The fields of an approval that the submit state of a pull request reads. */
type PullRequestApproval = {
  mode: "pull_request";
  pullRequestDraftMode: "generate_ai";
  pullRequestRoleLabel: string;
  pullRequestAvailable: boolean;
  isSubmitting: boolean;
  hasUncommittedChanges: boolean;
  approvalContextError: null;
  title: string;
  body: string;
  mergeMethod: "merge_commit";
  squashCommitMessage: string;
  squashCommitMessageTouched: boolean;
  hasSuggestedSquashCommitMessage: boolean;
};
type LaunchDefinition = {
  label: string;
  startModes: readonly string[];
  defaultStartMode: string;
};

// SAFETY: the workflows package exports these values and functions.
const workflows = await importProduct<{
  PULL_REQUEST_LAUNCH: LaunchDefinition;
  pullRequestRoleLabel: (workflow: TaskWorkflow) => string | null;
}>("packages/workflows/src/index.ts");
// SAFETY: agent-studio-quick-actions.ts exports these functions.
const quick = await importProduct<{
  buildAgentStudioQuickActions: (params: {
    selectedTask: TaskCard;
    sessionsForTask: readonly QuickSession[];
    roleEnabledByTask: Record<string, boolean>;
    gitProviderContext: GitProviderContext;
  }) => { id: string; label: string; disabled: boolean }[];
  buildRoleEnabledMapForTask: (task: TaskCard) => Record<string, boolean>;
}>("packages/frontend-core/src/sessions/start/agent-studio-quick-actions.ts");
// SAFETY: the shared test fixtures export the Git provider context.
const { createGitProviderContextFixture } = await importProduct<{
  createGitProviderContextFixture: () => GitProviderContext;
}>("packages/frontend-core/src/test-support/shared-test-fixtures.ts");
// SAFETY: task-approval-copy.ts exports these functions.
const approval = await importProduct<{
  taskApprovalPullRequestDraftOptions: (role: string | null) => readonly DraftOption[];
  taskApprovalGeneratePullRequestNotice: (role: string | null) => string;
  getTaskApprovalSubmitState: (
    model: PullRequestApproval,
    impact: { worktree: null; close: null },
    isPreparing: boolean,
  ) => { confirmLabel: string; confirmDisabled: boolean };
}>("packages/frontend-core/src/tasks/approval/task-approval-copy.ts");
// SAFETY: use-session-start-modal-coordinator.ts exports these functions.
const start = await importProduct<{
  buildSessionStartModalTitle: (role: string, workflow: TaskWorkflow) => string;
  buildSessionStartModalDescription: (args: {
    launchActionId: string;
    taskWorkflow: TaskWorkflow;
  }) => string;
}>("packages/frontend-core/src/sessions/start/use-session-start-modal-coordinator.ts");
// SAFETY: session-start-display.ts exports these functions.
const display = await importProduct<{
  orderStartModesForDisplay: (modes: readonly string[]) => string[];
  sessionStartModeButtonLabel: (mode: string) => string;
  sessionStartModelReadOnlyReason: (isStarting: boolean) => string;
}>("packages/frontend-core/src/sessions/start/session-start-display.ts");
// SAFETY: session-start-mode.ts exports this function.
const { resolveLaunchStartMode } = await importProduct<{
  resolveLaunchStartMode: (args: {
    launchActionId: string;
    taskWorkflow: TaskWorkflow;
    existingSessionOptions: readonly SessionOption[];
  }) => string;
}>("packages/frontend-core/src/sessions/start/session-start-mode.ts");
// SAFETY: session-start-reuse-options.ts exports this function.
const { buildPullRequestSessionOptions } = await importProduct<{
  buildPullRequestSessionOptions: (args: {
    task: TaskCard;
    sessions: readonly BuilderSession[];
  }) => SessionOption[];
}>("packages/frontend-core/src/sessions/start/session-start-reuse-options.ts");
// SAFETY: odt-tool-call.ts exports the cards of the ODT tools.
const { ODT_TOOL_CARDS } = await importProduct<{
  ODT_TOOL_CARDS: ReadonlyMap<string, { displayName: string; iconKind: string }>;
}>("packages/frontend-core/src/sessions/messages/odt-tool-call.ts");
// SAFETY: agent-chat-tool-presentation.ts exports this function.
const { workflowToolStatusLabel } = await importProduct<{
  workflowToolStatusLabel: (phase: string) => string | null;
}>("packages/frontend-core/src/sessions/messages/agent-chat-tool-presentation.ts");
// SAFETY: pull-request-presentation.ts exports these values.
const presentation = await importProduct<{
  pullRequestLabel: (pullRequest: { number: number }) => string;
}>("packages/frontend-core/src/tasks/pull-requests/pull-request-presentation.ts");
// SAFETY: these modules of the mobile app import no React Native code.
const { pullRequestPaint } = await importProduct<{
  pullRequestPaint: (pullRequest: { number: number; state: "open" }) => { icon: string };
}>("apps/mobile/src/features/tasks/presentation/task-badge-paint.ts");
const { toolIcon } = await importProduct<{
  toolIcon: (meta: { tool: string; toolType: string }, odtIcon: string | null) => string;
}>("apps/mobile/src/features/session/transcript/rows/tool-icon.ts");
const { ICONS } = await importProduct<{ ICONS: Record<string, string> }>(
  "apps/mobile/src/ui/icon-names.ts",
);

/** The search shortcut task in Human Review, with its spec, its plan, and an approved QA report. */
const searchTask = (): TaskCard => reviewTask(taskId(TASK));

/** The one Builder session of the task, which waits for the next message. */
const builderSession = (task: TaskCard): BuilderSession => ({
  externalSessionId: "builder-1",
  runtimeKind: "codex",
  workingDirectory: "/Users/sam/.openducktor/worktrees/fieldnotes/fieldnotes-k3x9",
  taskId: task.id,
  role: "build",
  startedAt: "2026-02-22T09:46:30.000Z",
  activityState: "idle",
  selectedModel: null,
});

describe("the pull request approval of the mobile app copied in the replicas", () => {
  test("Quick Actions of a task in Human Review list the actions of the app", () => {
    const task = searchTask();
    const options = quick.buildAgentStudioQuickActions({
      selectedTask: task,
      sessionsForTask: [
        {
          externalSessionId: "builder-1",
          runtimeKind: "codex",
          taskId: task.id,
          role: "build",
          status: "idle",
          startedAt: "2026-02-22T09:46:30.000Z",
          sessionAssociation: {
            kind: "workflow",
            workspaceId: "w",
            taskId: task.id,
            role: "build",
          },
        },
      ],
      roleEnabledByTask: quick.buildRoleEnabledMapForTask(task),
      gitProviderContext: createGitProviderContextFixture(),
    });
    expect(HUMAN_REVIEW_ACTIONS.map(({ id, title }) => ({ id, title }))).toEqual(
      options.map(({ id, label }) => ({ id, title: label })),
    );
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  test("the approval asks the Builder to write the pull request first", async () => {
    const role = workflows.pullRequestRoleLabel(searchTask().taskWorkflow);
    expect(role).toBe("Builder");
    const builder = role ?? "";
    expect(pullRequestDraftOptions(builder)).toEqual(
      approval.taskApprovalPullRequestDraftOptions(builder),
    );
    expect(pullRequestNotice(builder)).toBe(
      approval.taskApprovalGeneratePullRequestNotice(builder),
    );
    expect(
      await readProduct("packages/frontend-core/src/tasks/approval/use-task-approval-flow.ts"),
    ).toContain(`options?.pullRequestDraftMode ?? "${ASKED_DRAFT}"`);
    const submit = approval.getTaskApprovalSubmitState(
      {
        mode: "pull_request",
        pullRequestDraftMode: ASKED_DRAFT,
        pullRequestRoleLabel: builder,
        pullRequestAvailable: true,
        isSubmitting: false,
        hasUncommittedChanges: false,
        approvalContextError: null,
        title: "",
        body: "",
        mergeMethod: "merge_commit",
        squashCommitMessage: "",
        squashCommitMessageTouched: false,
        hasSuggestedSquashCommitMessage: true,
      },
      { worktree: null, close: null },
      false,
    );
    expect(submit.confirmLabel).toBe(chooseSessionLabel(builder));
    expect(submit.confirmDisabled).toBe(false);
  });

  test("the start of the pull request launch reuses the latest Builder session", async () => {
    const task = searchTask();
    const { taskWorkflow } = task;
    const launch = workflows.PULL_REQUEST_LAUNCH;
    expect(start.buildSessionStartModalTitle("build", taskWorkflow)).toBe("Start Builder session");
    expect(
      start.buildSessionStartModalDescription({ launchActionId: "pull_request", taskWorkflow }),
    ).toBe(START_SHEET_TEXT.chooseLead);
    expect(display.orderStartModesForDisplay(launch.startModes)).toEqual([...START_MODES.modes]);
    for (const mode of START_MODES.modes) {
      expect(display.sessionStartModeButtonLabel(mode)).toBe(START_MODE_LABELS[mode]);
    }
    const options = buildPullRequestSessionOptions({ task, sessions: [builderSession(task)] });
    expect(options.map(({ label, secondaryLabel }) => [label, secondaryLabel])).toEqual([
      [START_MODES.source, "Latest"],
    ]);
    expect(
      resolveLaunchStartMode({
        launchActionId: "pull_request",
        taskWorkflow,
        existingSessionOptions: options,
      }),
    ).toBe(START_MODES.selected);
    expect(display.sessionStartModelReadOnlyReason(false)).toBe(START_SHEET_TEXT.reuseModelHint);
    expect(display.sessionStartModelReadOnlyReason(true)).toBe(START_SHEET_TEXT.startingModelHint);
    const form = await readProduct(
      "apps/mobile/src/features/workflow/start-session/session-start-form.tsx",
    );
    expect(form).toContain(`<FormField label="${START_SHEET_TEXT.sessionMode}">`);
    expect(form).toContain(`label="${START_SHEET_TEXT.existingSession}"`);
    expect(form).toContain('icon="message-square"');
    expect(form).toContain(`? "${START_SHEET_TEXT.continueInBackground}"`);
    expect(form).toContain(`?? "${START_SHEET_TEXT.runInBackground}"`);
    expect(lucideName(MessageSquare.displayName)).toBe(ICONS["message-square"] ?? "");
  });

  test("the approval shows its loader while it reads the task details", async () => {
    expect(
      await readProduct("apps/mobile/src/features/workflow/approve/approve-task-sheet.tsx"),
    ).toContain(`label="${APPROVAL_TEXT.loadingDetails}"`);
    expect(await readProduct("packages/frontend-core/src/lib/use-minimum-loader.ts")).toContain(
      "export const MINIMUM_LOADER_MS = 500;",
    );
  });

  test("the Set Pull Request card shows the pull request that the call saved", async () => {
    const card = ODT_TOOL_CARDS.get("odt_set_pull_request");
    expect(card?.displayName).toBe(SET_PULL_REQUEST.title);
    const icon = toolIcon(
      { tool: "odt_set_pull_request", toolType: "workflow" },
      card?.iconKind ?? null,
    );
    expect(lucideName(GitPullRequest.displayName)).toBe(ICONS[icon] ?? "");
    expect(workflowToolStatusLabel("executing")).toBe(WORKFLOW_RUNNING_LABEL);
    expect(workflowToolStatusLabel("completed")).toBeNull();
    expect(presentation.pullRequestLabel(PULL_REQUEST)).toBe(pullRequestName(PULL_REQUEST.number));
    const state = pullRequestPaint({ number: PULL_REQUEST.number, state: "open" }).icon;
    expect(lucideName(GitPullRequest.displayName)).toBe(ICONS[state] ?? "");
    expect(lucideName(ExternalLink.displayName)).toBe(ICONS["external-link"] ?? "");
    expect(
      await readProductWords(["apps/mobile/src/features/tasks/presentation/task-chip-paint.ts"]),
    ).toContain('case "open": return dark ? palette.emerald400 : palette.emerald600;');
  });
});
