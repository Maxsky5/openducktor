import {
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  OpenExternalUrlInput,
  OpenInToolsService,
} from "../../application/system/open-in-tools-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseOpenExternalUrlInput = (args: HostCommandArgs): OpenExternalUrlInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), "open_external_url input");
  return { url: requireString(commandInputStringSchema.safeParse(record.url), "url") };
};

export const createOpenInToolsCommandHandlers = (service: OpenInToolsService) =>
  ({
    system_list_open_in_tools: (args) =>
      service.listOpenInTools(systemListOpenInToolsRequestSchema.parse(args ?? {})),
    system_open_directory_in_tool: (args) =>
      service
        .openDirectoryInTool(systemOpenDirectoryInToolRequestSchema.parse(args))
        .pipe(Effect.as({ ok: true })),
    open_external_url: (args) =>
      service.openExternalUrl(parseOpenExternalUrlInput(args)).pipe(Effect.as({ ok: true })),
  }) satisfies HostCommandHandlerDefinitions;
