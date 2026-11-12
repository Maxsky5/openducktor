// The Approve task sheet of the mobile app, as approve-task-sheet.tsx and approval-views.tsx in
// apps/mobile/src/features/workflow/approve, with the text of task-approval-copy.ts and
// task-approval-modal-header.ts in packages/frontend-core. The approval step chooses Direct merge,
// Pull request, or Close task. A direct merge chooses the merge method, a squash takes its commit
// message, and the cleanup switch removes the worktree and the branch. A pull request chooses its
// draft. When the target branch has a remote, Merge locally leads to the step that pushes the
// target branch and marks the task done. A scene shows the parts of a choice by
// `data-for-mode` and `data-for-method`.
import {
  ArrowDown,
  Check,
  ChevronDown,
  CircleCheckBig,
  GitMerge,
  GitPullRequest,
} from "lucide-react";
import type { ReactElement } from "react";
import { taskId as idOf } from "../../sample/workspace";
import { TASKS, type TaskKey } from "../../sample/tasks";
import {
  FormPanel,
  OptionCard,
  SectionLabel,
  SegmentedControl,
  SwitchCard,
  TextArea,
} from "./FormRows";
import { SheetButton, WorkflowSheet } from "./WorkflowSheet";
import "./ApproveSheet.css";

export type ApprovalMode = "direct_merge" | "pull_request" | "close_task";
export type MergeMethod = "merge_commit" | "squash" | "rebase";

/** The approval modes of TASK_APPROVAL_MODE_OPTIONS. */
export const APPROVAL_MODES = [
  { value: "direct_merge", label: "Direct merge" },
  { value: "pull_request", label: "Pull request" },
  { value: "close_task", label: "Close task" },
] as const satisfies readonly { value: ApprovalMode; label: string }[];

/** The merge methods of TASK_APPROVAL_MERGE_METHOD_OPTIONS. */
export const MERGE_METHODS = [
  {
    value: "merge_commit",
    label: "Merge commit",
    description: "Keep the branch history with a merge commit.",
  },
  {
    value: "squash",
    label: "Squash",
    description: "Combine the Builder branch changes into one commit.",
  },
  {
    value: "rebase",
    label: "Rebase",
    description: "Apply the Builder commits on top of the target branch.",
  },
] as const satisfies readonly { value: MergeMethod; label: string; description: string }[];

/** The fixed text of the approval sheet, from TASK_APPROVAL_COPY and the cleanup choice. */
export const APPROVAL_TEXT = {
  title: "Approve task",
  approvalAction: "Approval action",
  mergeMethod: "Merge method",
  squashMessage: "Squash commit message",
  pullRequestDraft: "Pull request draft",
  mergeLocally: "Merge locally",
  removeWorktree: "Remove worktree and branch",
  noUncommittedChanges: "No uncommitted changes.",
  worktreeDetails: "Worktree details",
  localMergeReady: "Local merge ready",
  nextStep: "Next step",
  localBranch: "Local branch",
  pushTo: "Push to",
  finishLater: "Finish later",
} as const;

/** A sentence with a branch name in the code font. */
export type CodeSentence = { before: string; code: string; after: string };

function CodeText({ text, strong = false }: { text: CodeSentence; strong?: boolean }) {
  return (
    <p className="mob-approve-code" data-strong={strong ? "" : undefined}>
      {text.before}
      <code>{text.code}</code>
      {text.after}
    </p>
  );
}

function TaskIntro({ task, lead }: { task: TaskKey; lead?: string }): ReactElement {
  return (
    <>
      {lead && <p className="mob-fsheet-lead">{lead}</p>}
      <p className="mob-fsheet-task">{TASKS[task].title}</p>
      <p className="mob-fsheet-id">{idOf(task)}</p>
    </>
  );
}

/** TaskCleanupChoice of a worktree without uncommitted changes, with the details closed. */
function CleanupChoice(): ReactElement {
  return (
    <SwitchCard label={APPROVAL_TEXT.removeWorktree} on>
      <p className="mob-approve-muted">{APPROVAL_TEXT.noUncommittedChanges}</p>
      <span className="mob-approve-link">
        {APPROVAL_TEXT.worktreeDetails}
        <ChevronDown />
      </span>
    </SwitchCard>
  );
}

type ApproveTaskSheetProps = {
  task: TaskKey;
  mode: ApprovalMode;
  method: MergeMethod;
  /** The suggested squash message: the oldest commit message of the task branch. */
  squashMessage: string;
  squashHint: CodeSentence;
  /** The role that creates the pull request, as the pull request draft names it. */
  pullRequestRole: string;
  hidden?: boolean | undefined;
};

/** The approval step. */
export function ApproveTaskSheet({
  task,
  mode,
  method,
  squashMessage,
  squashHint,
  pullRequestRole,
  hidden,
}: ApproveTaskSheetProps): ReactElement {
  const pullRequest = mode === "pull_request";
  return (
    <WorkflowSheet
      id="approve"
      title={APPROVAL_TEXT.title}
      intro={<TaskIntro task={task} />}
      hidden={hidden}
      primary={
        <>
          <SheetButton
            variant="filled"
            Icon={GitMerge}
            label={APPROVAL_TEXT.mergeLocally}
            hidden={pullRequest}
            data-for-mode="direct_merge"
            data-merge-locally=""
          />
          <SheetButton
            variant="filled"
            Icon={GitPullRequest}
            label={`Choose ${pullRequestRole} session`}
            hidden={!pullRequest}
            data-for-mode="pull_request"
          />
        </>
      }
    >
      <div className="mob-approve-section">
        <SectionLabel text={APPROVAL_TEXT.approvalAction} />
        <SegmentedControl options={APPROVAL_MODES} selected={mode} hook="approval" />
      </div>
      <div className="mob-approve-section" hidden={pullRequest} data-for-mode="direct_merge">
        <SectionLabel text={APPROVAL_TEXT.mergeMethod} />
        {MERGE_METHODS.map((option) => (
          <OptionCard
            key={option.value}
            value={option.value}
            title={option.label}
            description={option.description}
            selected={option.value === method}
          />
        ))}
      </div>
      <div
        hidden={pullRequest || method !== "squash"}
        data-for-mode="direct_merge"
        data-for-method="squash"
      >
        <FormPanel>
          <TextArea label={APPROVAL_TEXT.squashMessage} value={squashMessage} />
          <CodeText text={squashHint} />
        </FormPanel>
      </div>
      <div hidden={pullRequest} data-for-mode="direct_merge">
        <CleanupChoice />
      </div>
      <div className="mob-approve-section" hidden={!pullRequest} data-for-mode="pull_request">
        <SectionLabel text={APPROVAL_TEXT.pullRequestDraft} />
        <OptionCard
          value="manual"
          title="Write manually"
          description="Write the pull request title and description."
          selected={false}
        />
        <OptionCard
          value="generate_ai"
          title={`Ask ${pullRequestRole}`}
          description={`Let ${pullRequestRole} create or update the pull request.`}
          selected
        />
      </div>
      <div hidden={!pullRequest} data-for-mode="pull_request">
        <FormPanel muted>
          <p className="mob-approve-muted">{`Next, choose the ${pullRequestRole} session to use.`}</p>
        </FormPanel>
      </div>
    </WorkflowSheet>
  );
}

type PublishSheetProps = {
  task: TaskKey;
  /** The local target branch, such as main. */
  branch: string;
  /** The remote branch that the push updates, such as origin/main. */
  remoteBranch: string;
  /** The merged commit that the push publishes. */
  commit: string;
  /** The push destinations of the remote. */
  destinations: readonly string[];
  hidden?: boolean | undefined;
};

/** The completion step of a local direct merge whose target branch has a remote. */
export function PublishSheet({
  task,
  branch,
  remoteBranch,
  commit,
  destinations,
  hidden,
}: PublishSheetProps): ReactElement {
  return (
    <WorkflowSheet
      id="publish"
      title="Publish and mark done"
      intro={
        <TaskIntro
          task={task}
          lead={`The local merge is already applied. Push ${remoteBranch} to publish it, then move the task to Done.`}
        />
      }
      hidden={hidden}
      note="Finish later to keep the task in Human Review while the local merge stays ready to publish."
      secondary={<SheetButton variant="outline" label={APPROVAL_TEXT.finishLater} />}
      primary={
        <SheetButton
          variant="warning"
          Icon={CircleCheckBig}
          label={`Push ${branch} and mark done`}
          data-publish=""
        />
      }
    >
      <div className="mob-approve-tone">
        <span className="mob-approve-tone-icon">
          <Check />
        </span>
        <span className="mob-approve-tone-text">
          <b>{APPROVAL_TEXT.localMergeReady}</b>
          <CodeText
            text={{
              before: "The code is already merged into ",
              code: branch,
              after: " on this computer.",
            }}
            strong
          />
        </span>
      </div>
      <FormPanel>
        <b className="mob-approve-step">{APPROVAL_TEXT.nextStep}</b>
        <CodeText
          text={{
            before: "Push ",
            code: remoteBranch,
            after: " to publish the merged target branch, then move the task to Done.",
          }}
        />
        <div className="mob-approve-branch">
          <SectionLabel text={APPROVAL_TEXT.localBranch} />
          <code>{branch}</code>
        </div>
        <ArrowDown className="mob-approve-arrow" />
        <div className="mob-approve-branch">
          <SectionLabel text={APPROVAL_TEXT.pushTo} />
          <code>{remoteBranch}</code>
          <span className="mob-approve-preview">
            <span>{`Commit ${commit.slice(0, 12)}`}</span>
            {destinations.map((destination) => (
              <span key={destination}>{destination}</span>
            ))}
          </span>
        </div>
      </FormPanel>
      <CleanupChoice />
    </WorkflowSheet>
  );
}
