import { type LocalImageReadInput, localImageReadInputSchema } from "@openducktor/contracts";
import type {
  LocalAttachmentResolveInput,
  LocalAttachmentService,
  LocalAttachmentStageInput,
} from "../../application/attachments/local-attachment-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseStageInput = (args: HostCommandArgs): LocalAttachmentStageInput => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "workspace_stage_local_attachment input",
  );
  return {
    name: requireString(commandInputStringSchema.safeParse(record.name), "Attachment name"),
    base64Data: requireString(
      commandInputStringSchema.safeParse(record.base64Data),
      "Attachment payload",
    ),
  };
};

const parseResolveInput = (args: HostCommandArgs): LocalAttachmentResolveInput => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "workspace_resolve_local_attachment_path input",
  );
  return {
    path: requireString(commandInputStringSchema.safeParse(record.path), "Attachment path"),
  };
};

const parseLocalImageInput = (args: HostCommandArgs): LocalImageReadInput => {
  const parsed = localImageReadInputSchema.safeParse(args);
  if (!parsed.success)
    throw new HostValidationError({
      field: "local_image_read",
      message: "The image request needs the absolute path of an image file.",
      cause: parsed.error,
    });
  return parsed.data;
};

export const createLocalAttachmentCommandHandlers = (
  localAttachmentService: LocalAttachmentService,
) =>
  ({
    local_image_read: (args) => localAttachmentService.readImage(parseLocalImageInput(args)),
    workspace_resolve_local_attachment_path: (args) =>
      localAttachmentService.resolve(parseResolveInput(args)),
    workspace_stage_local_attachment: (args) => localAttachmentService.stage(parseStageInput(args)),
  }) satisfies HostCommandHandlerDefinitions;
