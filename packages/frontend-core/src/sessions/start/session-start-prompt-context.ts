import type { GitTargetBranch } from "@openducktor/contracts";
import {
  kickoffPromptContextKind,
  type KickoffPromptContextKind,
  type AgentKickoffTemplateId,
  type BuildAgentKickoffPromptInput,
  resolvePullRequestTarget,
} from "@openducktor/workflows";
import { effectiveTaskTargetBranch } from "../../lib/target-branch";

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
  const targetBranch = effectiveTaskTargetBranch(taskTargetBranch, repoDefaultTargetBranch);
  resolvePullRequestTarget(targetBranch);
  return {
    git: {
      targetBranch,
    },
  };
};

const KICKOFF_PROMPT_CONTEXT_RESOLVERS = {
  none: resolveContextFreePrompt,
  human_feedback: resolveHumanFeedbackPrompt,
  pull_request: resolvePullRequestPrompt,
} satisfies Record<KickoffPromptContextKind, KickoffPromptContextResolver>;

export const resolveSessionStartKickoffPromptContext = async (
  input: ResolveSessionStartKickoffPromptContextInput,
): Promise<SessionStartKickoffPromptContext> => {
  return KICKOFF_PROMPT_CONTEXT_RESOLVERS[kickoffPromptContextKind(input.templateId)](input);
};
