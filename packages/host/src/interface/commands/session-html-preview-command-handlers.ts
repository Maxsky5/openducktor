import { sessionHtmlPreviewReadRequestSchema } from "@openducktor/contracts";
import type { SessionHtmlPreviewService } from "../../application/html-previews/session-html-preview-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseCommandInput } from "./command-inputs";

export const createSessionHtmlPreviewCommandHandlers = (
  service: Pick<SessionHtmlPreviewService, "read">,
) =>
  ({
    session_html_preview_read: (args) =>
      service.read(
        parseCommandInput(sessionHtmlPreviewReadRequestSchema, args, "session_html_preview_read"),
      ),
  }) satisfies HostCommandHandlerDefinitions;
