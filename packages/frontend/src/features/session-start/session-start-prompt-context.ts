import type { GitTargetBranch } from "@openducktor/contracts";
import type { AgentKickoffTemplateId, BuildAgentKickoffPromptInput } from "@openducktor/core";
import { effectiveTaskTargetBranch } from "@/lib/target-branch";

export const FEEDBACK_MESSAGE_REQUIRED_ERROR = "Feedback message is required before sending.";

type SessionStartKickoffPromptContext = Pick<
  BuildAgentKickoffPromptInput,
  "extraPlaceholders" | "git"
>;

type ResolveSessionStartKickoffPromptContextInput = {
  templateId: AgentKickoffTemplateId;
  message?: string;
  taskTargetBranch?: GitTargetBranch;
  loadRepoDefaultTargetBranch: () => Promise<GitTargetBranch | null>;
};

type KickoffPromptContextResolver = (
  input: ResolveSessionStartKickoffPromptContextInput,
) => SessionStartKickoffPromptContext | Promise<SessionStartKickoffPromptContext>;

const resolveContextFreePrompt: KickoffPromptContextResolver = () => ({});

const resolveHumanFeedbackPrompt: KickoffPromptContextResolver = ({ message }) => {
  const humanFeedback = message?.trim() ?? "";
  if (!humanFeedback) {
    throw new Error(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  }

  return {
    extraPlaceholders: {
      humanFeedback,
    },
  };
};

const resolvePullRequestPrompt: KickoffPromptContextResolver = async ({
  taskTargetBranch,
  loadRepoDefaultTargetBranch,
}) => {
  const repoDefaultTargetBranch = taskTargetBranch ? null : await loadRepoDefaultTargetBranch();
  return {
    git: {
      targetBranch: effectiveTaskTargetBranch(taskTargetBranch, repoDefaultTargetBranch),
    },
  };
};

const KICKOFF_PROMPT_CONTEXT_RESOLVERS = {
  "kickoff.spec_initial": resolveContextFreePrompt,
  "kickoff.planner_initial": resolveContextFreePrompt,
  "kickoff.build_implementation_start": resolveContextFreePrompt,
  "kickoff.build_after_qa_rejected": resolveContextFreePrompt,
  "kickoff.build_after_human_request_changes": resolveHumanFeedbackPrompt,
  "kickoff.build_pull_request_generation": resolvePullRequestPrompt,
  "kickoff.qa_review": resolveContextFreePrompt,
} satisfies Record<AgentKickoffTemplateId, KickoffPromptContextResolver>;

export const resolveSessionStartKickoffPromptContext = async (
  input: ResolveSessionStartKickoffPromptContextInput,
): Promise<SessionStartKickoffPromptContext> => {
  return KICKOFF_PROMPT_CONTEXT_RESOLVERS[input.templateId](input);
};
