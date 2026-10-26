import {
  type AgentQuestionDraftEntry,
  agentQuestionTitle,
  formatAgentQuestionAnswerPreview,
  isAgentQuestionAnswered,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-draft";
import { buildQuestionContentEntries } from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-keys";
import { QUESTION_SUMMARY_TAB_ID } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-draft";
import type { AgentQuestionRequest } from "@openducktor/frontend-core/types/agent-orchestrator";

/** One step of a Structured Question: a question, or the summary of a multi-question request. */
export type QuestionFlowStep = {
  /** The tab ID of the core question draft: the question index, or the summary ID. */
  tabId: string;
  key: string;
  title: string;
  answered: boolean;
  isSummary: boolean;
};

type QuestionSummaryRow = {
  key: string;
  questionIndex: number;
  title: string;
  answer: string;
  answered: boolean;
};

/**
 * The primary action of the active step. A multi-question request reviews its summary before it
 * submits. A single question submits at once.
 */
type QuestionFlowAction =
  | { kind: "next"; label: string; tabId: string }
  | { kind: "review"; label: string; tabId: string }
  | { kind: "submit"; label: string; enabled: boolean };

export type QuestionFlowView = {
  steps: QuestionFlowStep[];
  /** "Question 2 of 3", "Summary", or null for a single question. */
  progressLabel: string | null;
  action: QuestionFlowAction;
  /** The rows of the summary step, or an empty list on a question step. */
  summary: QuestionSummaryRow[];
};

const SUBMIT_ANSWERS_LABEL = "Confirm Answers";

/** Builds the navigation, progress, and action of a Structured Question from its draft. */
export const buildQuestionFlowView = ({
  request,
  draft,
  activeTabId,
  isComplete,
}: {
  request: AgentQuestionRequest;
  draft: readonly AgentQuestionDraftEntry[];
  activeTabId: string;
  isComplete: boolean;
}): QuestionFlowView => {
  const entries = buildQuestionContentEntries(request.questions);
  const count = request.questions.length;
  const multiple = count > 1;
  const isSummary = multiple && activeTabId === QUESTION_SUMMARY_TAB_ID;
  const activeIndex = isSummary ? -1 : Math.min(Math.max(0, Number(activeTabId) || 0), count - 1);
  const steps: QuestionFlowStep[] = entries.map(({ question, contentKey }, index) => ({
    tabId: String(index),
    key: contentKey,
    title: agentQuestionTitle(question, index),
    answered: isAgentQuestionAnswered(question, draft[index]),
    isSummary: false,
  }));
  if (multiple) {
    steps.push({
      tabId: QUESTION_SUMMARY_TAB_ID,
      key: QUESTION_SUMMARY_TAB_ID,
      title: "Summary",
      answered: isComplete,
      isSummary: true,
    });
  }

  const summary: QuestionSummaryRow[] = isSummary
    ? entries.map(({ question, contentKey }, index) => ({
        key: contentKey,
        questionIndex: index,
        title: agentQuestionTitle(question, index),
        answer: formatAgentQuestionAnswerPreview(question, draft[index]),
        answered: isAgentQuestionAnswered(question, draft[index]),
      }))
    : [];

  let action: QuestionFlowAction = {
    kind: "submit",
    label: SUBMIT_ANSWERS_LABEL,
    enabled: isComplete,
  };
  if (multiple && !isSummary) {
    action =
      activeIndex + 1 < count
        ? { kind: "next", label: "Next", tabId: String(activeIndex + 1) }
        : { kind: "review", label: "Review Answers", tabId: QUESTION_SUMMARY_TAB_ID };
  }

  let progressLabel: string | null = null;
  if (isSummary) progressLabel = "Summary";
  else if (multiple) progressLabel = `Question ${activeIndex + 1} of ${count}`;

  return { steps, progressLabel, action, summary };
};
