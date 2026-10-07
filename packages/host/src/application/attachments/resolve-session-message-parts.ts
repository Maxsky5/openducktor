import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import { Effect } from "effect";
import { hasMeaningfulAgentUserMessageParts } from "@openducktor/core";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { LocalAttachmentService } from "./local-attachment-service";

/** Resolve staged files before a launch changes task state or creates a session. */
export const resolveSessionMessageParts = (
  parts: AgentSessionUserMessagePart[],
  attachments: Pick<LocalAttachmentService, "resolve">,
) =>
  Effect.gen(function* () {
    if (
      !parts.some((part) => part.kind === "attachment") &&
      !hasMeaningfulAgentUserMessageParts(parts.filter((part) => part.kind !== "attachment"))
    )
      return yield* new HostValidationError({
        field: "parts",
        message: "Enter a message before sending.",
      });
    if (
      parts.some((part) => part.kind === "attachment") &&
      parts.some((part) => part.kind === "slash_command")
    )
      return yield* new HostValidationError({
        field: "parts",
        message: "Slash commands and attachments cannot be combined in one message.",
      });
    return yield* resolveSessionAttachments(parts, attachments);
  });

export const resolveSessionAttachments = (
  parts: AgentSessionUserMessagePart[],
  attachments: Pick<LocalAttachmentService, "resolve">,
) =>
  Effect.forEach(parts, (part) =>
    Effect.gen(function* () {
      if (part.kind !== "attachment") return part;
      const { path } = yield* attachments.resolve({ path: part.attachment.path });
      return { ...part, attachment: { ...part.attachment, path } };
    }),
  ).pipe(Effect.mapError((cause) => toHostOperationError(cause, "session-message.attachments")));
