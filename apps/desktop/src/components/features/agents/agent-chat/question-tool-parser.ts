import { isQuestionToolName } from "@/lib/question-tools";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

export type QuestionToolDetail = {
  prompt: string;
  answers: string[];
};

const parseJsonIfPossible = (value: string | undefined): unknown => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const readQuestionPrompt = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.question,
    record.prompt,
    record.header,
    record.title,
    record.label,
    record.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const normalizeAnswerValues = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeAnswerValues(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return normalizeAnswerValues(
    record.answers ??
      record.answer ??
      record.response ??
      record.responses ??
      record.value ??
      record.text,
  );
};

const collectQuestionDetails = (value: unknown): QuestionToolDetail[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const prompt = readQuestionPrompt(entry);
      if (!prompt) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const answers = normalizeAnswerValues(
        record.answers ?? record.answer ?? record.response ?? record.responses,
      );
      return {
        prompt,
        answers,
      };
    })
    .filter((entry): entry is QuestionToolDetail => entry !== null);
};

const normalizeAnswerGroups = (value: unknown): string[][] => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAnswerValues(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const nested =
    record.answers ??
    record.answer ??
    record.responses ??
    record.response ??
    record.result ??
    record.value;
  if (nested === undefined) {
    return Object.values(record)
      .map((entry) => normalizeAnswerValues(entry))
      .filter((entry) => entry.length > 0);
  }
  return normalizeAnswerGroups(nested);
};

const firstNonEmptyAnswerGroups = (candidates: unknown[]): string[][] => {
  for (const candidate of candidates) {
    const groups = normalizeAnswerGroups(candidate)
      .map((entry) => entry.filter((value) => value.trim().length > 0))
      .filter((entry) => entry.length > 0);
    if (groups.length > 0) {
      return groups;
    }
  }
  return [];
};

export const questionToolDetails = (meta: ToolMeta): QuestionToolDetail[] => {
  if (!isQuestionToolName(meta.tool)) {
    return [];
  }

  const inputQuestions = collectQuestionDetails(meta.input?.questions);
  const metadataQuestions = collectQuestionDetails(meta.metadata?.questions);
  const parsedOutput = parseJsonIfPossible(meta.output);
  const outputQuestions = collectQuestionDetails(
    parsedOutput && typeof parsedOutput === "object"
      ? (parsedOutput as Record<string, unknown>).questions
      : undefined,
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

  const outputRecord =
    parsedOutput && typeof parsedOutput === "object"
      ? (parsedOutput as Record<string, unknown>)
      : undefined;
  const answerGroups = firstNonEmptyAnswerGroups([
    outputRecord,
    outputRecord?.answers,
    outputRecord?.answer,
    outputRecord?.responses,
    outputRecord?.response,
    outputRecord?.result,
    outputRecord?.value,
    meta.metadata,
    meta.metadata?.answers,
    meta.metadata?.answer,
    meta.metadata?.responses,
    meta.metadata?.response,
    meta.input,
    meta.input?.answers,
    meta.input?.answer,
    meta.input?.responses,
    meta.input?.response,
  ]);

  if (answerGroups.length === 0) {
    return questions;
  }

  return questions.map((entry, index) => ({
    prompt: entry.prompt,
    answers: entry.answers.length > 0 ? entry.answers : (answerGroups[index] ?? []),
  }));
};
