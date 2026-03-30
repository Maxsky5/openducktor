import type { AgentUserMessagePart } from "../types/agent-orchestrator";

const trimBoundaryTextPart = (
  part: AgentUserMessagePart,
  edge: "start" | "end",
): AgentUserMessagePart => {
  if (part.kind !== "text") {
    return part;
  }
  return {
    ...part,
    text: edge === "start" ? part.text.trimStart() : part.text.trimEnd(),
  };
};

export const normalizeAgentUserMessageParts = (
  parts: AgentUserMessagePart[],
): AgentUserMessagePart[] => {
  const merged = parts.reduce<AgentUserMessagePart[]>((acc, part) => {
    if (part.kind === "text") {
      const previous = acc[acc.length - 1];
      if (previous?.kind === "text") {
        previous.text += part.text;
        return acc;
      }
    }

    acc.push(part.kind === "text" ? { ...part } : part);
    return acc;
  }, []);

  if (merged.length === 0) {
    return [];
  }

  const normalized = merged.map((part, index) => {
    if (index === 0) {
      return trimBoundaryTextPart(part, "start");
    }
    if (index === merged.length - 1) {
      return trimBoundaryTextPart(part, "end");
    }
    return part;
  });

  return normalized.filter((part) => part.kind !== "text" || part.text.length > 0);
};

export const hasMeaningfulAgentUserMessageParts = (parts: AgentUserMessagePart[]): boolean => {
  return normalizeAgentUserMessageParts(parts).length > 0;
};

export const serializeAgentUserMessagePartsToText = (parts: AgentUserMessagePart[]): string => {
  return normalizeAgentUserMessageParts(parts)
    .map((part) => {
      if (part.kind === "text") {
        return part.text;
      }
      if (part.kind === "slash_command") {
        return `/${part.command.trigger}`;
      }
      return `@${part.file.path}`;
    })
    .join("");
};
