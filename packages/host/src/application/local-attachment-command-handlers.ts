import type { HostCommandHandlers } from "./host-command-router";
import type { LocalAttachmentService } from "./local-attachment-service";

export const createLocalAttachmentCommandHandlers = (
  localAttachmentService: LocalAttachmentService,
): HostCommandHandlers => ({
  workspace_resolve_local_attachment_path: (args) => localAttachmentService.resolve(args),
  workspace_stage_local_attachment: (args) => localAttachmentService.stage(args),
});
