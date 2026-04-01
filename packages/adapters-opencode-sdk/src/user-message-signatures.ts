import {
  type AgentModelSelection,
  type AgentUserMessageDisplayPart,
  type AgentUserMessagePart,
  buildAgentUserMessagePromptText,
  normalizeAgentUserMessageParts,
  serializeAgentUserMessagePartsToText,
} from "@openducktor/core";

type ComparableNonTextPart =
  | {
      kind: "file_reference";
      path: string;
      name: string;
      sourceText?: {
        value: string;
        start: number;
        end: number;
      };
    }
  | {
      kind: "attachment";
      path: string;
      name: string;
      attachmentKind: "image" | "audio" | "video" | "pdf";
      mime?: string;
    };

const buildComparableSignature = (input: {
  visible: string;
  nonTextParts: ComparableNonTextPart[];
  model?: AgentModelSelection;
}): string => {
  const model = input.model;
  return JSON.stringify({
    visible: input.visible.trim(),
    nonTextParts: input.nonTextParts,
    providerId: model?.providerId ?? null,
    modelId: model?.modelId ?? null,
    variant: model?.variant ?? null,
    profileId: model?.profileId ?? null,
  });
};

export const buildQueuedRequestSignature = (
  parts: AgentUserMessagePart[],
  model?: AgentModelSelection,
): string => {
  const normalizedParts = normalizeAgentUserMessageParts(parts);
  const promptText = buildAgentUserMessagePromptText(normalizedParts);
  const nonTextParts: ComparableNonTextPart[] = [
    ...promptText.fileReferences.map(({ file, sourceText }) => ({
      kind: "file_reference" as const,
      path: file.path,
      name: file.name,
      sourceText,
    })),
    ...normalizedParts.flatMap((part) => {
      if (part.kind !== "attachment") {
        return [];
      }

      return [
        {
          kind: "attachment" as const,
          path: part.attachment.path,
          name: part.attachment.name,
          attachmentKind: part.attachment.kind,
          ...(part.attachment.mime ? { mime: part.attachment.mime } : {}),
        },
      ];
    }),
  ];

  return buildComparableSignature({
    visible: serializeAgentUserMessagePartsToText(normalizedParts),
    nonTextParts,
    ...(model ? { model } : {}),
  });
};

export const buildQueuedDisplaySignature = (input: {
  visible: string;
  parts: AgentUserMessageDisplayPart[];
  model?: AgentModelSelection;
}): string => {
  const nonTextParts = input.parts.flatMap((part): ComparableNonTextPart[] => {
    if (part.kind === "file_reference") {
      return [
        {
          kind: "file_reference",
          path: part.file.path,
          name: part.file.name,
          ...(part.sourceText ? { sourceText: part.sourceText } : {}),
        },
      ];
    }
    if (part.kind === "attachment") {
      return [
        {
          kind: "attachment",
          path: part.attachment.path,
          name: part.attachment.name,
          attachmentKind: part.attachment.kind,
          ...(part.attachment.mime ? { mime: part.attachment.mime } : {}),
        },
      ];
    }
    return [];
  });

  return buildComparableSignature({
    visible: input.visible,
    nonTextParts,
    ...(input.model ? { model: input.model } : {}),
  });
};
