import { describe, expect, test } from "bun:test";
import {
  isManualSessionCompactionSlashCommand,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
  slashCommandDescriptorSchema,
  slashCommandSourceSchema,
} from "./slash-command-schemas";

describe("system slash commands", () => {
  test("parses the canonical manual compaction descriptor", () => {
    expect(slashCommandSourceSchema.parse("system")).toBe("system");
    expect(slashCommandDescriptorSchema.parse(MANUAL_SESSION_COMPACTION_SLASH_COMMAND)).toEqual(
      MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
    );
    expect(isManualSessionCompactionSlashCommand(MANUAL_SESSION_COMPACTION_SLASH_COMMAND)).toBe(
      true,
    );
  });

  test("requires the canonical system identity for privileged routing", () => {
    expect(
      isManualSessionCompactionSlashCommand({
        ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        id: "provider:compact",
      }),
    ).toBe(false);
    expect(
      isManualSessionCompactionSlashCommand({
        ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        source: "command",
      }),
    ).toBe(false);
    expect(
      isManualSessionCompactionSlashCommand({
        ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        trigger: "COMPACT",
      }),
    ).toBe(true);
  });
});
