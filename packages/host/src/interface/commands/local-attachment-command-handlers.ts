import type {
  LocalAttachmentResolveInput,
  LocalAttachmentService,
  LocalAttachmentStageInput,
} from "../../application/attachments/local-attachment-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const parseStageInput = (args: Record<string, unknown> | undefined): LocalAttachmentStageInput => {
  const record = requireRecord(args, "workspace_stage_local_attachment input");
  return {
    name: requireString(record.name, "Attachment name"),
    base64Data: requireString(record.base64Data, "Attachment payload"),
  };
};

const parseResolveInput = (
  args: Record<string, unknown> | undefined,
): LocalAttachmentResolveInput => {
  const record = requireRecord(args, "workspace_resolve_local_attachment_path input");
  return { path: requireString(record.path, "Attachment path") };
};

export const createLocalAttachmentCommandHandlers = (
  localAttachmentService: LocalAttachmentService,
): HostCommandHandlers => ({
  workspace_resolve_local_attachment_path: (args) =>
    localAttachmentService.resolve(parseResolveInput(args)),
  workspace_stage_local_attachment: (args) => localAttachmentService.stage(parseStageInput(args)),
});
