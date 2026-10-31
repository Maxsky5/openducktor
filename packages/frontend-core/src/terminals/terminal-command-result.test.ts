import { expect, test } from "bun:test";
import type { TerminalCommandResult } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "./terminal-command-result";

const cases = [
  {
    name: "clean exit",
    result: { type: "exited", exitCode: 0, signal: null, outputTail: [] },
    succeeded: true,
  },
  {
    name: "nonzero exit",
    result: { type: "exited", exitCode: 1, signal: null, outputTail: [] },
    succeeded: false,
  },
  {
    name: "unknown exit code",
    result: { type: "exited", exitCode: null, signal: null, outputTail: [] },
    succeeded: false,
  },
  {
    name: "signal with exit code zero",
    result: { type: "exited", exitCode: 0, signal: "SIGTERM", outputTail: [] },
    succeeded: false,
  },
  {
    name: "empty signal with exit code zero",
    result: { type: "exited", exitCode: 0, signal: "", outputTail: [] },
    succeeded: false,
  },
  {
    name: "terminal closed before confirmation",
    result: { type: "closed", outputTail: [] },
    succeeded: false,
  },
  {
    name: "terminal failure",
    result: { type: "failed", message: "The terminal disconnected.", outputTail: [] },
    succeeded: false,
  },
] satisfies { name: string; result: TerminalCommandResult; succeeded: boolean }[];

test.each(cases)("classifies terminal command success: $name", ({ result, succeeded }) => {
  expect(terminalCommandSucceeded(result)).toBe(succeeded);
});
