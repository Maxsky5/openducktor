import { expect, test } from "bun:test";
import { HOST_COMMAND_NAMES } from "./host-command-contracts";
import { HOST_READ_COMMAND_NAMES, isHostReadCommand } from "./host-read-command-contracts";

test("names only host commands that read, once each", () => {
  expect(new Set(HOST_READ_COMMAND_NAMES).size).toBe(HOST_READ_COMMAND_NAMES.length);
  for (const command of HOST_READ_COMMAND_NAMES) expect(HOST_COMMAND_NAMES).toContain(command);
  expect(isHostReadCommand("agent_runtime_load_session_history")).toBe(true);
  expect(isHostReadCommand("agent_session_message_submit")).toBe(false);
  expect(isHostReadCommand("agent_session_live_attach")).toBe(false);
});
