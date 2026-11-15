import { agentToolDataSchema, type AgentToolData } from "@openducktor/contracts";
import { z } from "zod";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { hasNonEmptyText } from "./tool-lifecycle";

const questionJsonValueSchema = z.json();

export type QuestionToolOption = {
  label: string;
  description: string | null;
};

export type QuestionToolDetail = {
  prompt: string;
  /** The short label of the question, such as `Auth method`, when the prompt is another text. */
  header: string | null;
  options: QuestionToolOption[];
  /** The question takes one or more of its options. */
  multiple: boolean;
  answers: string[];
};

type AgentToolValue = AgentToolData[string];

const isAgentToolData = (value: AgentToolValue | undefined): value is AgentToolData =>
  agentToolDataSchema.safeParse(value).success;

const parseJsonIfPossible = (value: string | undefined): AgentToolValue | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return questionJsonValueSchema.parse(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
};

const readQuestionPrompt = (value: AgentToolData): string | null => {
  const candidates = [
    value.question,
    value.prompt,
    value.header,
    value.title,
    value.label,
    value.name,
  ];
  for (const candidate of candidates) {
    if (hasNonEmptyText(candidate)) {
      return candidate.trim();
    }
  }
  return null;
};

const normalizeAnswerValues = (value: AgentToolValue | undefined): string[] => {
  if (hasNonEmptyText(value)) {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeAnswerValues(entry));
  }
  if (!isAgentToolData(value)) {
    return [];
  }
  return normalizeAnswerValues(
    value.answers ?? value.answer ?? value.response ?? value.responses ?? value.value ?? value.text,
  );
};

const readQuestionOptions = (value: AgentToolValue | undefined): QuestionToolOption[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): QuestionToolOption[] => {
    if (hasNonEmptyText(entry)) {
      return [{ label: entry.trim(), description: null }];
    }
    if (!isAgentToolData(entry) || !hasNonEmptyText(entry.label)) {
      return [];
    }
    const { description } = entry;
    return [
      {
        label: entry.label.trim(),
        description: hasNonEmptyText(description) ? description.trim() : null,
      },
    ];
  });
};

const collectQuestionDetails = (value: AgentToolValue | undefined): QuestionToolDetail[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<QuestionToolDetail[]>((details, entry) => {
    if (!isAgentToolData(entry)) {
      return details;
    }
    const prompt = readQuestionPrompt(entry);
    if (!prompt) {
      return details;
    }
    const header = hasNonEmptyText(entry.header) ? entry.header.trim() : null;
    details.push({
      prompt,
      header: header === prompt ? null : header,
      options: readQuestionOptions(entry.options),
      // Claude `AskUserQuestion` names the flag `multiSelect`. The OpenCode `Question.Prompt` schema
      // and the Codex questions of the adapter name it `multiple`.
      multiple: entry.multiple === true || entry.multiSelect === true,
      answers: normalizeAnswerValues(
        entry.answers ?? entry.answer ?? entry.response ?? entry.responses,
      ),
    });
    return details;
  }, []);
};

const normalizeAnswerGroups = (value: AgentToolValue | undefined): string[][] => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAnswerValues(entry));
  }
  if (!isAgentToolData(value)) {
    return [];
  }
  const nested =
    value.answers ??
    value.answer ??
    value.responses ??
    value.response ??
    value.result ??
    value.value;
  if (nested === undefined) {
    return Object.values(value).map((entry) => normalizeAnswerValues(entry));
  }
  return normalizeAnswerGroups(nested);
};

/**
 * The answer groups of the first candidate with an answer, one group for each question. A question
 * without an answer keeps its empty group, so the next answers stay with their questions.
 */
const firstNonEmptyAnswerGroups = (candidates: Array<AgentToolValue | undefined>): string[][] => {
  for (const candidate of candidates) {
    const groups = normalizeAnswerGroups(candidate);
    if (groups.some((answers) => answers.length > 0)) {
      return groups;
    }
  }
  return [];
};

export const questionToolDetails = (meta: ToolMeta): QuestionToolDetail[] => {
  if (meta.toolType !== "question") {
    return [];
  }

  const parsedInput = questionJsonValueSchema.safeParse(meta.input);
  const parsedMetadata = questionJsonValueSchema.safeParse(meta.metadata);
  const inputRecord =
    parsedInput.success && isAgentToolData(parsedInput.data) ? parsedInput.data : undefined;
  const metadataRecord =
    parsedMetadata.success && isAgentToolData(parsedMetadata.data)
      ? parsedMetadata.data
      : undefined;
  const inputQuestions = collectQuestionDetails(inputRecord?.questions);
  const metadataQuestions = collectQuestionDetails(metadataRecord?.questions);
  const parsedOutput = parseJsonIfPossible(meta.output);
  const outputQuestions = collectQuestionDetails(
    parsedOutput && isAgentToolData(parsedOutput) ? parsedOutput.questions : undefined,
  );
  const questions =
    inputQuestions.length > 0
      ? inputQuestions
      : metadataQuestions.length > 0
        ? metadataQuestions
        : outputQuestions;

  if (questions.length === 0) {
    return [];
  }

  const outputRecord = parsedOutput && isAgentToolData(parsedOutput) ? parsedOutput : undefined;
  const answerGroups = firstNonEmptyAnswerGroups([
    outputRecord,
    outputRecord?.answers,
    outputRecord?.answer,
    outputRecord?.responses,
    outputRecord?.response,
    outputRecord?.result,
    outputRecord?.value,
    metadataRecord,
    metadataRecord?.answers,
    metadataRecord?.answer,
    metadataRecord?.responses,
    metadataRecord?.response,
    inputRecord,
    inputRecord?.answers,
    inputRecord?.answer,
    inputRecord?.responses,
    inputRecord?.response,
  ]);

  return questions.map((entry, index) => ({
    ...entry,
    answers: entry.answers.length > 0 ? entry.answers : (answerGroups[index] ?? []),
  }));
};

/** The options that the answers of a question chose, and each answer that the user wrote once. */
export type QuestionAnswerChoices = {
  selectedLabels: ReadonlySet<string>;
  customAnswers: string[];
};

/** Splits the answers of a question into chosen options and written answers. */
export const readQuestionAnswerChoices = (detail: QuestionToolDetail): QuestionAnswerChoices => {
  const labels = new Set(detail.options.map((option) => option.label));
  const selectedLabels = new Set<string>();
  const customAnswers = new Set<string>();
  for (const answer of detail.answers) {
    if (labels.has(answer)) {
      selectedLabels.add(answer);
    } else {
      customAnswers.add(answer);
    }
  }
  return { selectedLabels, customAnswers: [...customAnswers] };
};
