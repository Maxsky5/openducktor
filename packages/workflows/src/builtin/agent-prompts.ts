import type {
  GitConflictOperation,
  GitTargetBranch,
  RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  requirePullRequestTarget,
  type AgentPromptGitContext,
  type BuiltAgentPrompt,
  type MergePromptOverridesInput,
} from "../task-workflow/task-prompts";
import {
  GIT_CONFLICT_INSTRUCTIONS,
  PROMPT_TEMPLATES,
  type PromptTemplate,
} from "./prompt-templates";
import { builtinTaskWorkflow } from "./task-workflow";
import type { BuiltinIssueTypeId, BuiltinPromptTemplateId, BuiltinRoleId } from "./ids";

export type {
  AgentPromptGitContext,
  AgentPromptWarning,
  BuiltAgentPrompt,
  MergePromptOverridesInput,
  ResolvedAgentPromptTemplate,
} from "../task-workflow/task-prompts";

export type AgentPromptTaskContext = {
  taskId: string;
  title: string;
  issueType: BuiltinIssueTypeId;
  status: string;
  description?: string;
};

export type BuildAgentPromptInput = {
  role: BuiltinRoleId;
  task: AgentPromptTaskContext;
  overrides?: RepoPromptOverrides;
};

export type AgentKickoffTemplateId = Extract<BuiltinPromptTemplateId, `kickoff.${string}`>;

export type BuildAgentKickoffPromptInput = {
  role: BuiltinRoleId;
  templateId: AgentKickoffTemplateId;
  task: {
    taskId: string;
    title?: string;
    issueType?: BuiltinIssueTypeId;
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

export type AgentMessageTemplateId = Extract<BuiltinPromptTemplateId, `message.${string}`>;

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

const prompts = builtinTaskWorkflow.prompts;

/** The launch action of each kickoff and message template. Built-in templates have one each. */
const launchActionByTemplate = new Map(
  builtinTaskWorkflow.definition.steps.flatMap((step) =>
    step.kind === "agent"
      ? step.launchActions.map((launch) => [launch.template.id, launch.id] as const)
      : [],
  ),
);
const launchActionOf = (templateId: string): string => {
  const launchActionId = launchActionByTemplate.get(templateId);
  if (launchActionId === undefined) {
    throw new Error(`Unknown prompt template id "${templateId}".`);
  }
  return launchActionId;
};

/** Required facts stay outside custom task text so overrides cannot drop the target. */
export const buildGitConflictAssistancePrompt = (input: {
  git: GitConflictRequestContext;
  task?: { context: BuildAgentMessagePromptInput["task"]; overrides: RepoPromptOverrides };
}): string => {
  const { git, task } = input;
  if (!git.operation || !git.workingDirectory.trim()) {
    throw new Error(
      "Restore the Git conflict operation and working directory before asking for assistance.",
    );
  }
  const operationLabel = GIT_CONFLICT_OPERATION_LABELS[git.operation];
  const available = (value: string | null) => value?.trim() || "Unavailable";
  const instructions = task
    ? buildAgentMessagePrompt({
        role: "build",
        templateId: "message.build_rebase_conflict_resolution",
        task: task.context,
        overrides: task.overrides,
        git: {
          operationLabel,
          currentBranch: available(git.currentBranch),
          targetBranch: available(git.targetBranch),
          conflictedFiles: [...git.conflictedFiles],
          conflictOutput: available(git.conflictOutput),
        },
      })
    : GIT_CONFLICT_INSTRUCTIONS;
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
  requirePullRequestTarget("kickoff.build_pull_request_generation", targetBranch);

export const listBuiltinAgentPromptTemplates = (): PromptTemplate[] =>
  Object.values<PromptTemplate>(PROMPT_TEMPLATES).map((definition) => ({ ...definition }));

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
