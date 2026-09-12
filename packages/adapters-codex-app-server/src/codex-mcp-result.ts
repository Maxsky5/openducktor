import type { AgentToolImage, CodexAppServerJsonValue } from "@openducktor/contracts";
import {
  arrayFromCodexJsonValue,
  extractStringField,
  isPlainObject,
  readCodexString,
  stringifyJsonValue,
} from "./codex-app-server-shared";

const DATA_URL_PREFIX_PATTERN = /^data:[^,]*,/;

export type CodexToolResultTextOptions = {
  readTextOnMediaBlocks?: boolean;
};

export const codexToolResultText = (
  value: CodexAppServerJsonValue | undefined,
  options: CodexToolResultTextOptions = {},
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const textValue = readCodexString(value);
  if (textValue !== null) {
    return textValue;
  }
  const content = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? arrayFromCodexJsonValue(value.content)
      : [];
  const text = content
    .map((entry) => {
      const entryText = readCodexString(entry);
      if (entryText !== null) {
        return entryText;
      }
      if (!isPlainObject(entry)) {
        return "";
      }
      const entryType = extractStringField(entry, ["type"]);
      const isMediaBlock = entryType === "inputImage" || entryType === "image";
      if (isMediaBlock && options.readTextOnMediaBlocks !== true) {
        return "";
      }
      return extractStringField(entry, ["text"]) ?? "";
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n");
  return text.length > 0 ? text : null;
};

export const codexToolResultDisplayText = (
  value: CodexAppServerJsonValue | undefined,
): string | null => codexToolResultText(value) ?? stringifyJsonValue(value);

export const codexToolResultImages = (
  value: CodexAppServerJsonValue | undefined,
): AgentToolImage[] => {
  if (!isPlainObject(value)) {
    return [];
  }
  const images: AgentToolImage[] = [];
  for (const entry of arrayFromCodexJsonValue(value.content)) {
    if (!isPlainObject(entry) || extractStringField(entry, ["type"]) !== "image") {
      continue;
    }
    const mimeType = extractStringField(entry, ["mimeType"]);
    const data = extractStringField(entry, ["data"]);
    if (!mimeType || !data) {
      continue;
    }
    const dataBase64 = data.replace(DATA_URL_PREFIX_PATTERN, "");
    if (!dataBase64) {
      continue;
    }
    images.push({ mimeType, dataBase64 });
  }
  return images;
};
