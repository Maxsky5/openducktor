import { agentToolDataSchema, type AgentToolData } from "@openducktor/contracts";
import { z } from "zod";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { hasNonEmptyText } from "./tool-lifecycle";

export type QuestionToolDetail = {
  prompt: string;
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
    return z.json().parse(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
};

const readQuestionPrompt = (value: AgentToolValue | undefined): string | null => {
  if (!isAgentToolData(value)) {
    return null;
  }
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

const collectQuestionDetails = (value: AgentToolValue | undefined): QuestionToolDetail[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<QuestionToolDetail[]>((details, entry) => {
    const prompt = readQuestionPrompt(entry);
    if (!prompt) {
      return details;
    }
    if (!isAgentToolData(entry)) {
      return details;
    }
    const answers = normalizeAnswerValues(
      entry.answers ?? entry.answer ?? entry.response ?? entry.responses,
    );
    details.push({
      prompt,
      answers,
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
    return Object.values(value).reduce<string[][]>((groups, entry) => {
      const answers = normalizeAnswerValues(entry);
      if (answers.length > 0) {
        groups.push(answers);
      }
      return groups;
    }, []);
  }
  return normalizeAnswerGroups(nested);
};

const firstNonEmptyAnswerGroups = (candidates: Array<AgentToolValue | undefined>): string[][] => {
  for (const candidate of candidates) {
    const groups = normalizeAnswerGroups(candidate).reduce<string[][]>((nextGroups, entry) => {
      const answers = entry.filter((value) => value.trim().length > 0);
      if (answers.length > 0) {
        nextGroups.push(answers);
      }
      return nextGroups;
    }, []);
    if (groups.length > 0) {
      return groups;
    }
  }
  return [];
};

export const questionToolDetails = (meta: ToolMeta): QuestionToolDetail[] => {
  if (meta.toolType !== "question") {
    return [];
  }

  const parsedInput = z.json().safeParse(meta.input);
  const parsedMetadata = z.json().safeParse(meta.metadata);
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

  if (answerGroups.length === 0) {
    return questions;
  }

  return questions.map((entry, index) => ({
    prompt: entry.prompt,
    answers: entry.answers.length > 0 ? entry.answers : (answerGroups[index] ?? []),
  }));
};
