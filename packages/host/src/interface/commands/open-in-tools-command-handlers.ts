import {
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  OpenExternalUrlInput,
  OpenInToolsService,
} from "../../application/system/open-in-tools-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const parseOpenExternalUrlInput = (
  args: Record<string, unknown> | undefined,
): OpenExternalUrlInput => {
  const record = requireRecord(args, "open_external_url input");
  return { url: requireString(record.url, "url") };
};

export const createOpenInToolsCommandHandlers = (
  service: OpenInToolsService,
): HostCommandHandlers => ({
  system_list_open_in_tools: (args) =>
    service.listOpenInTools(systemListOpenInToolsRequestSchema.parse(args ?? {})),
  system_open_directory_in_tool: (args) =>
    service
      .openDirectoryInTool(systemOpenDirectoryInToolRequestSchema.parse(args))
      .pipe(Effect.as({ ok: true })),
  open_external_url: (args) =>
    service.openExternalUrl(parseOpenExternalUrlInput(args)).pipe(Effect.as({ ok: true })),
});
