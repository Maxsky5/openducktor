import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  classifyAgentApprovalMutation,
  isReadOnlyAgentRole,
  isReadOnlyShellCommand,
  isSafeReadToolName,
} from "./approval-policy";

describe("approval policy", () => {
  const workflowToolAliasesByCanonical = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;

  test("identifies read-only roles and safe read tools", () => {
    expect(isReadOnlyAgentRole("spec")).toBe(true);
    expect(isReadOnlyAgentRole("planner")).toBe(true);
    expect(isReadOnlyAgentRole("qa")).toBe(true);
    expect(isReadOnlyAgentRole("build")).toBe(false);
    expect(isSafeReadToolName(" read ")).toBe(true);
    expect(isSafeReadToolName("write")).toBe(false);
  });

  test("classifies canonical and aliased ODT workflow tools", () => {
    for (const actionName of [
      "odt_set_plan",
      "openducktor_odt_set_plan",
      "functions.openducktor_odt_set_plan",
    ]) {
      expect(classifyAgentApprovalMutation({ actionName, workflowToolAliasesByCanonical })).toBe(
        "mutating",
      );
    }

    expect(
      classifyAgentApprovalMutation({
        actionName: "functions.openducktor_odt_read_task",
        workflowToolAliasesByCanonical,
      }),
    ).toBe("read_only");
  });

  test("continues command classification for unknown runtime tools", () => {
    expect(
      classifyAgentApprovalMutation({
        actionName: "tool",
        toolName: "custom_runtime_tool",
        command: "rm -rf /tmp",
        workflowToolAliasesByCanonical,
      }),
    ).toBe("mutating");
    expect(
      classifyAgentApprovalMutation({
        actionName: "tool",
        toolName: "custom_runtime_tool",
        workflowToolAliasesByCanonical,
      }),
    ).toBe("unknown");
  });

  test("classifies shell-like runtime tools by command safety", () => {
    expect(
      classifyAgentApprovalMutation({
        actionName: "tool",
        toolName: "bash",
        command: "python build.py",
      }),
    ).toBe("mutating");
    expect(
      classifyAgentApprovalMutation({
        actionName: "tool",
        toolName: "shell",
        command: "git status",
      }),
    ).toBe("read_only");
  });

  test("handles quoted and escaped shell separators without unsafe splitting", () => {
    expect(isReadOnlyShellCommand(`echo "a && b" && printf '%s\n' 'c; d'`)).toBe(true);
    expect(isReadOnlyShellCommand(String.raw`echo a\;b || pwd`)).toBe(true);
    expect(isReadOnlyShellCommand("pwd\nls")).toBe(true);
    expect(isReadOnlyShellCommand(`echo "safe`)).toBe(false);
  });
});
