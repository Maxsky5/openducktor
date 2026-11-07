import {
  PULL_REQUEST_LAUNCH_ID,
  WORKFLOW_PROMPT_IDS,
  type IssueType,
  type GitConflictOperation,
  type GitTargetBranch,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  requirePullRequestTarget,
  type AgentPromptGitContext,
  type BuiltAgentPrompt,
  type MergePromptOverridesInput,
  type OwnedPromptTemplate,
} from "../../task-workflow/task-prompts";
import { GIT_CONFLICT_INSTRUCTIONS } from "./prompt-templates";
import { specPlanBuildWorkflow } from "./workflow";
import type { BuiltinRoleId } from "../roles/ids";
import type { SpecPlanBuildPromptId } from "./ids";

export type {
  AgentPromptGitContext,
  AgentPromptWarning,
  BuiltAgentPrompt,
  MergePromptOverridesInput,
  ResolvedAgentPromptTemplate,
} from "../../task-workflow/task-prompts";

export type AgentPromptTaskContext = {
  taskId: string;
  title: string;
  issueType: IssueType;
  status: string;
  description?: string;
};

export type BuildAgentPromptInput = {
  role: BuiltinRoleId;
  task: AgentPromptTaskContext;
  overrides?: RepoPromptOverrides;
};

/** The prompt of the Spec, Plan, Build workflow that a launch sends into a running session. */
export type AgentMessageTemplateId = "messages.build_git_conflict";
/** The prompts of the Spec, Plan, Build workflow that start a session. */
export type AgentKickoffTemplateId = Exclude<
  Extract<SpecPlanBuildPromptId, `messages.${string}`>,
  AgentMessageTemplateId
>;

export type BuildAgentKickoffPromptInput = {
  role: BuiltinRoleId;
  templateId: AgentKickoffTemplateId;
  task: {
    taskId: string;
    title?: string;
    issueType?: IssueType;
    status?: string;
    description?: string;
  };
  extraPlaceholders?: Partial<Record<"humanFeedback", string>>;
  git?: AgentKickoffPromptGitContext;
  overrides?: RepoPromptOverrides;
};

export type AgentKickoffPromptGitContext = {
  targetBranch?: GitTargetBranch;
};

export type GitConflictRequestContext = {
  operation: GitConflictOperation;
  workingDirectory: string;
  currentBranch: string | null;
  targetBranch: string | null;
  conflictedFiles: readonly string[];
  conflictOutput: string | null;
};

export type BuildAgentMessagePromptInput = {
  role: BuiltinRoleId;
  templateId: AgentMessageTemplateId;
  task: BuildAgentKickoffPromptInput["task"];
  git?: AgentPromptGitContext;
  overrides?: RepoPromptOverrides;
};

export type BuildReadOnlyPermissionRejectionMessageInput = {
  role: BuiltinRoleId;
  overrides?: RepoPromptOverrides;
};

const prompts = specPlanBuildWorkflow.prompts;

/** The launch action of each kickoff and message template. Built-in templates have one each. */
const launchActionByTemplate = new Map<string, string>([
  ...specPlanBuildWorkflow.definition.steps.flatMap((step) =>
    step.kind === "agent"
      ? step.launchActions.map((launch) => [launch.template.id, launch.id] as const)
      : [],
  ),
  [WORKFLOW_PROMPT_IDS.pullRequest, PULL_REQUEST_LAUNCH_ID],
]);
const launchActionOf = (templateId: string): string => {
  const launchActionId = launchActionByTemplate.get(templateId);
  if (launchActionId === undefined) {
    throw new Error(`Unknown prompt template id "${templateId}".`);
  }
  return launchActionId;
};

const unavailable = (value: string | null) => value?.trim() || "Unavailable";

/** The labelled conflict facts that a Git conflict message template renders. */
export const gitConflictPromptContext = (git: GitConflictRequestContext): AgentPromptGitContext => {
  if (!git.operation || !git.workingDirectory.trim()) {
    throw new Error(
      "Restore the Git conflict operation and working directory before asking for assistance.",
    );
  }
  return {
    operationLabel: GIT_CONFLICT_OPERATION_LABELS[git.operation],
    currentBranch: unavailable(git.currentBranch),
    targetBranch: unavailable(git.targetBranch),
    conflictedFiles: [...git.conflictedFiles],
    conflictOutput: unavailable(git.conflictOutput),
  };
};

/** Required facts stay outside custom task text so overrides cannot drop the target. */
export const buildGitConflictAssistancePrompt = (input: {
  git: GitConflictRequestContext;
  instructions?: string;
}): string => {
  const { git } = input;
  const { operationLabel } = gitConflictPromptContext(git);
  const available = unavailable;
  const instructions = input.instructions ?? GIT_CONFLICT_INSTRUCTIONS;
  return [
    instructions,
    [
      "Git conflict context",
      `- Operation: ${operationLabel}`,
      `- Working directory: ${git.workingDirectory}`,
      `- Current branch: ${available(git.currentBranch)}`,
      `- Target branch: ${available(git.targetBranch)}`,
      "- Conflicted files:",
      git.conflictedFiles.length
        ? git.conflictedFiles.map((path) => `  - ${path}`).join("\n")
        : "  Unavailable",
      "Git output:",
      available(git.conflictOutput),
    ].join("\n"),
  ].join("\n\n");
};

export const resolvePullRequestTarget = (targetBranch: GitTargetBranch | undefined): string =>
  requirePullRequestTarget(WORKFLOW_PROMPT_IDS.pullRequest, targetBranch);

/** The prompts of the Spec, Plan, Build workflow and of the roles that it binds. */
export const listSpecPlanBuildPromptTemplates = (): OwnedPromptTemplate[] =>
  prompts.templates.map((definition) => ({ ...definition }));

export const buildAgentSystemPromptBundle = (input: BuildAgentPromptInput): BuiltAgentPrompt =>
  prompts.systemPrompt(input);

export function buildAgentSystemPrompt(input: BuildAgentPromptInput): string {
  return buildAgentSystemPromptBundle(input).prompt;
}

export const buildAgentKickoffPromptBundle = (
  input: BuildAgentKickoffPromptInput,
): BuiltAgentPrompt =>
  prompts.kickoffPrompt({
    launchActionId: launchActionOf(input.templateId),
    role: input.role,
    task: input.task,
    humanFeedback: input.extraPlaceholders?.humanFeedback,
    targetBranch: input.git?.targetBranch,
    overrides: input.overrides,
  });

export const buildAgentKickoffPrompt = (input: BuildAgentKickoffPromptInput): string =>
  buildAgentKickoffPromptBundle(input).prompt;

export const buildAgentMessagePromptBundle = (
  input: BuildAgentMessagePromptInput,
): BuiltAgentPrompt =>
  prompts.messagePrompt({
    launchActionId: launchActionOf(input.templateId),
    task: input.task,
    git: input.git ?? {},
    overrides: input.overrides,
  });

export const buildAgentMessagePrompt = (input: BuildAgentMessagePromptInput): string =>
  buildAgentMessagePromptBundle(input).prompt;

export const buildReadOnlyPermissionRejectionMessage = (
  input: BuildReadOnlyPermissionRejectionMessageInput,
): string => prompts.readOnlyRejection(input);

export const mergePromptOverrides = (input: MergePromptOverridesInput): RepoPromptOverrides =>
  prompts.mergeOverrides(input);

const GIT_CONFLICT_OPERATION_LABELS = {
  rebase: "rebase",
  pull_rebase: "pull with rebase",
  direct_merge_merge_commit: "direct merge with a merge commit",
  direct_merge_squash: "direct squash merge",
  direct_merge_rebase: "direct merge with rebase",
} satisfies Record<GitConflictOperation, string>;
