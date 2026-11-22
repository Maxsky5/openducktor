import { describe, expect, test } from "bun:test";
import type { CodexAppServerAutoApprovalReviewCompletedParams } from "@openducktor/contracts";
import type { JSONType } from "zod";
import {
  type CodexAllowableReviewAction,
  CodexGuardianEventConversionError,
  parseCodexReviewAction,
  toCodexGuardianAssessmentEvent,
} from "./codex-guardian-assessment-event";

// Codex runs on the host, so the terminal directory is an absolute path of the host platform.
const [TERMINAL_DIR, TERMINAL_DIR_URI] =
  process.platform === "win32"
    ? ["C:\\repo dir", "file:///C:/repo%20dir"]
    : ["/repo dir", "file:///repo%20dir"];

const deniedReview = (
  action: CodexAppServerAutoApprovalReviewCompletedParams["action"],
): CodexAppServerAutoApprovalReviewCompletedParams => {
  // Codex sends more fields than the notification schema checks.
  const params = {
    threadId: "thread-1",
    turnId: "turn-1",
    reviewId: "review-1",
    startedAtMs: 1_000,
    completedAtMs: 2_000,
    decisionSource: "agent",
    targetItemId: "item-1",
    review: {
      status: "denied",
      riskLevel: "high",
      userAuthorization: "low",
      rationale: "The command deletes files outside the workspace.",
    },
    action,
  };
  return params;
};

const allowable = (
  action: CodexAppServerAutoApprovalReviewCompletedParams["action"],
): CodexAllowableReviewAction => {
  const parsed = parseCodexReviewAction(action);
  if (parsed.type === "other")
    throw new Error(`Expected an allowable action: ${parsed.actionType}`);
  return parsed;
};

const convert = (params: CodexAppServerAutoApprovalReviewCompletedParams) =>
  toCodexGuardianAssessmentEvent(params, allowable(params.action));

describe("toCodexGuardianAssessmentEvent", () => {
  test("keeps the review fields that the Codex TUI sends back, in snake_case", () => {
    const event = convert(
      deniedReview({ type: "command", source: "shell", command: "rm -rf /tmp/x", cwd: "/repo" }),
    );
    expect(event).toEqual({
      id: "review-1",
      turn_id: "turn-1",
      started_at_ms: 1_000,
      completed_at_ms: 2_000,
      status: "denied",
      risk_level: "high",
      user_authorization: "low",
      rationale: "The command deletes files outside the workspace.",
      decision_source: "agent",
      action: { type: "command", source: "shell", command: "rm -rf /tmp/x", cwd: "/repo" },
    });
  });

  const conversions: Array<
    [CodexAppServerAutoApprovalReviewCompletedParams["action"], Record<string, JSONType>]
  > = [
    [
      { type: "execve", source: "unifiedExec", program: "/bin/ls", argv: ["ls", "-a"], cwd: "/r" },
      { type: "execve", source: "unified_exec", program: "/bin/ls", argv: ["ls", "-a"], cwd: "/r" },
    ],
    [
      { type: "writeStdin", approvalId: "a-1", processId: "p-1", stdin: "y\n", cwd: TERMINAL_DIR },
      {
        type: "write_stdin",
        approval_id: "a-1",
        process_id: "p-1",
        stdin: "y\n",
        cwd: TERMINAL_DIR_URI,
      },
    ],
    [
      { type: "applyPatch", cwd: "/repo", files: ["/repo/a.ts"] },
      { type: "apply_patch", cwd: "/repo", files: ["/repo/a.ts"] },
    ],
    [
      {
        type: "networkAccess",
        target: "https://x.dev",
        host: "x.dev",
        protocol: "socks5Tcp",
        port: 443,
      },
      {
        type: "network_access",
        target: "https://x.dev",
        host: "x.dev",
        protocol: "socks5_tcp",
        port: 443,
      },
    ],
    [
      {
        type: "mcpToolCall",
        server: "github",
        toolName: "merge",
        connectorId: null,
        connectorName: "GitHub",
        toolTitle: null,
      },
      {
        type: "mcp_tool_call",
        server: "github",
        tool_name: "merge",
        connector_id: null,
        connector_name: "GitHub",
        tool_title: null,
      },
    ],
  ];
  test.each(conversions)("converts a %p action to the core action", (action, expected) => {
    expect(convert(deniedReview(action)).action).toEqual(expected);
  });

  test("parses an action that OpenDucktor cannot send back as another action", () => {
    expect(
      parseCodexReviewAction({
        type: "requestPermissions",
        reason: null,
        permissions: { network: null, fileSystem: null },
      }),
    ).toEqual({ type: "other", actionType: "requestPermissions" });
    expect(
      parseCodexReviewAction({ type: "command", source: "zsh", command: "x", cwd: "/" }),
    ).toEqual({ type: "other", actionType: "command" });
    expect(parseCodexReviewAction({ type: "applyPatch", cwd: "/repo" })).toEqual({
      type: "other",
      actionType: "applyPatch",
    });
  });

  test("fails with a typed error for a review that Codex did not deny", () => {
    const approved = deniedReview({ type: "command", source: "shell", command: "x", cwd: "/" });
    approved.review.status = "approved";
    expect(() => convert(approved)).toThrow(CodexGuardianEventConversionError);
  });
});
