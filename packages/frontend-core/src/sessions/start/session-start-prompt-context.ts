import type { GitTargetBranch } from "@openducktor/contracts";
import {
  type KickoffPromptContextKind,
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
  templateId: string;
  context: KickoffPromptContextKind;
  message?: string;
  taskTargetBranch?: GitTargetBranch;
  repoDefaultTargetBranch: GitTargetBranch | null;
};

type KickoffPromptContextResolver = (
  input: ResolveSessionStartKickoffPromptContextInput,
) => SessionStartKickoffPromptContext;

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

const resolvePullRequestPrompt: KickoffPromptContextResolver = ({
  taskTargetBranch,
  repoDefaultTargetBranch,
}) => {
  const targetBranch = effectiveTaskTargetBranch(taskTargetBranch, repoDefaultTargetBranch);
  if (!targetBranch)
    throw new Error(
      "The workspace default target branch is not loaded. Open the workspace, then retry.",
    );
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

export const resolveSessionStartKickoffPromptContext = (
  input: ResolveSessionStartKickoffPromptContextInput,
): SessionStartKickoffPromptContext => {
  return KICKOFF_PROMPT_CONTEXT_RESOLVERS[input.context](input);
};
