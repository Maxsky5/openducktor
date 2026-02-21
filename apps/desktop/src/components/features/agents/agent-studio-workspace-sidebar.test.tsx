import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStudioWorkspaceSidebar } from "./agent-studio-workspace-sidebar";

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

describe("AgentStudioWorkspaceSidebar", () => {
  test("renders permission requests and document sections", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          agentStudioReady: true,
          pendingPermissions: [
            {
              requestId: "perm-1",
              permission: "bash",
              patterns: ["git status"],
            },
          ],
          isSubmittingPermissionByRequestId: {},
          permissionReplyErrorByRequestId: {},
          onReplyPermission: () => {},
          specDoc: {
            ...emptyDoc,
            markdown: "# Spec",
            updatedAt: "2026-02-21T10:00:00.000Z",
          },
          planDoc: {
            ...emptyDoc,
            markdown: "# Plan",
          },
          qaDoc: {
            ...emptyDoc,
            markdown: "",
          },
        },
      }),
    );

    expect(html).toContain("Permission Requests");
    expect(html).toContain("bash");
    expect(html).toContain("Allow Once");
    expect(html).toContain("Documents");
    expect(html).toContain("Spec");
    expect(html).toContain("Implementation Plan");
    expect(html).toContain("QA Report");
    expect(html).toContain("No QA report yet.");
  });

  test("shows empty permission state", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioWorkspaceSidebar, {
        model: {
          agentStudioReady: true,
          pendingPermissions: [],
          isSubmittingPermissionByRequestId: {},
          permissionReplyErrorByRequestId: {},
          onReplyPermission: () => {},
          specDoc: emptyDoc,
          planDoc: emptyDoc,
          qaDoc: emptyDoc,
        },
      }),
    );

    expect(html).toContain("No pending permission requests.");
  });
});
