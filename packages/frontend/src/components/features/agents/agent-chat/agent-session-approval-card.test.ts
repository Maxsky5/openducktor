import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentSessionApprovalCard,
  resolveApprovalReplyOutcomes,
} from "./agent-session-approval-card";

const approvalRequest = {
  requestId: "approval-1",
  requestType: "runtime_tool" as const,
  title: "Approve runtime tool",
  supportedReplyOutcomes: ["approve_once" as const, "approve_turn" as const, "reject" as const],
};

describe("resolveApprovalReplyOutcomes", () => {
  test("intersects request outcomes with runtime descriptor outcomes", () => {
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["approve_once", "approve_turn", "reject"],
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      }),
    ).toEqual(["approve_once", "reject"]);
  });

  test("uses runtime outcomes when request outcomes are omitted", () => {
    expect(
      resolveApprovalReplyOutcomes({
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      }),
    ).toEqual(["approve_once", "approve_session", "reject"]);
  });

  test("disables approval replies when runtime capabilities are unavailable", () => {
    expect(
      resolveApprovalReplyOutcomes({
        requestSupportedReplyOutcomes: ["approve_once", "reject"],
        runtimeSupportedReplyOutcomes: null,
      }),
    ).toEqual([]);
  });

  test("renders only outcomes supported by the active runtime", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: approvalRequest,
        runtimeSupportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        onReply: async () => {},
      }),
    );

    expect(html).toContain("Approve once");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Approve for turn");
  });

  test("keeps reply controls disabled when runtime capabilities are unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentSessionApprovalCard, {
        request: approvalRequest,
        runtimeSupportedReplyOutcomes: null,
        onReply: async () => {},
      }),
    );

    expect(html).not.toContain("Approve once");
    expect(html).not.toContain("Reject");
    expect(html).toContain("Runtime approval capabilities are unavailable for this request.");
    expect(html).toContain("Refresh runtime checks or reattach the session, then try again.");
  });
});
