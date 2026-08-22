import {
  type AgentModelSelection,
  type AgentUserMessageDisplayPart,
  type AgentUserMessagePart,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";
import { buildOpenCodePromptText } from "./opencode-user-message-encoding";

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
      kind: "subagent_reference";
      id: string;
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

type AttachmentPathMode = "strict" | "identity";

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
  return buildQueuedRequestSignatureWithAttachmentPathMode(parts, model, "strict");
};

export const buildQueuedRequestAttachmentIdentitySignature = (
  parts: AgentUserMessagePart[],
  model?: AgentModelSelection,
): string => {
  return buildQueuedRequestSignatureWithAttachmentPathMode(parts, model, "identity");
};

const buildQueuedRequestSignatureWithAttachmentPathMode = (
  parts: AgentUserMessagePart[],
  model: AgentModelSelection | undefined,
  attachmentPathMode: AttachmentPathMode,
): string => {
  const normalizedParts = normalizeAgentUserMessageParts(parts);
  const promptText = buildOpenCodePromptText(normalizedParts);
  const nonTextParts: ComparableNonTextPart[] = [
    ...promptText.fileReferences.map(({ file, sourceText }) => ({
      kind: "file_reference" as const,
      path: file.path,
      name: file.name,
      sourceText,
    })),
    ...promptText.subagentReferences.map(({ subagent, sourceText }) => ({
      kind: "subagent_reference" as const,
      id: subagent.id,
      name: subagent.name,
      sourceText,
    })),
    ...normalizedParts.flatMap((part) => {
      if (part.kind !== "attachment") {
        return [];
      }

      return [
        {
          kind: "attachment" as const,
          path: attachmentPathMode === "strict" ? part.attachment.path : "",
          name: part.attachment.name,
          attachmentKind: part.attachment.kind,
          ...(() => {
            if (part.attachment.mime) {
              return { mime: part.attachment.mime };
            }
            return {};
          })(),
        },
      ];
    }),
  ];

  return buildComparableSignature({
    visible: promptText.text,
    nonTextParts,
    ...(() => {
      if (model) {
        return { model };
      }
      return {};
    })(),
  });
};

export const buildQueuedDisplaySignature = (input: {
  visible: string;
  parts: AgentUserMessageDisplayPart[];
  model?: AgentModelSelection;
}): string => {
  return buildQueuedDisplaySignatureWithAttachmentPathMode(input, "strict");
};

export const buildQueuedDisplayAttachmentIdentitySignature = (input: {
  visible: string;
  parts: AgentUserMessageDisplayPart[];
  model?: AgentModelSelection;
}): string => {
  return buildQueuedDisplaySignatureWithAttachmentPathMode(input, "identity");
};

const buildQueuedDisplaySignatureWithAttachmentPathMode = (
  input: {
    visible: string;
    parts: AgentUserMessageDisplayPart[];
    model?: AgentModelSelection;
  },
  attachmentPathMode: AttachmentPathMode,
): string => {
  const nonTextParts = input.parts.flatMap((part): ComparableNonTextPart[] => {
    if (part.kind === "file_reference") {
      return [
        {
          kind: "file_reference",
          path: part.file.path,
          name: part.file.name,
          ...(() => {
            if (part.sourceText) {
              return { sourceText: part.sourceText };
            }
            return {};
          })(),
        },
      ];
    }
    if (part.kind === "attachment") {
      return [
        {
          kind: "attachment",
          path: attachmentPathMode === "strict" ? part.attachment.path : "",
          name: part.attachment.name,
          attachmentKind: part.attachment.kind,
          ...(() => {
            if (part.attachment.mime) {
              return { mime: part.attachment.mime };
            }
            return {};
          })(),
        },
      ];
    }
    if (part.kind === "subagent_reference") {
      return [
        {
          kind: "subagent_reference",
          id: part.subagent.id,
          name: part.subagent.name,
          ...(() => {
            if (part.sourceText) {
              return { sourceText: part.sourceText };
            }
            return {};
          })(),
        },
      ];
    }
    return [];
  });

  return buildComparableSignature({
    visible: input.visible,
    nonTextParts,
    ...(() => {
      if (input.model) {
        return { model: input.model };
      }
      return {};
    })(),
  });
};
