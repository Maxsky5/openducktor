import { describe, expect, test } from "bun:test";
import type { WorkflowDocumentView } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { newWorkflowDocument } from "@openducktor/workflows";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import { useEditorSession } from "./use-editor-session";

const view = (version: number | null): WorkflowDocumentView => ({
  workflowId: "bug_fix",
  source: "custom",
  kind: version === null ? "draft" : "version",
  version,
  latestVersion: 11,
  document: newWorkflowDocument("bug_fix", "Bug fix"),
});

let goTo: (path: string) => void = () => {};

function SessionProbe(): ReactElement {
  const params = useParams();
  goTo = useNavigate();
  const routeVersion = params.version === undefined ? null : Number(params.version);
  const { session } = useEditorSession(params.workflowId ?? "", routeVersion);
  return (
    <output aria-label="Session">
      {session ? `${session.routeId} ${session.routeVersion ?? "draft"}` : "loading"}
    </output>
  );
}

describe("useEditorSession", () => {
  test("opens the draft after a version view of the same workflow", async () => {
    const connection = createTestClientConnection({
      client: {
        workflowDocumentGet: async (input: { workflowId: string; version?: number }) =>
          view(input.version ?? null),
      },
    });
    render(
      <QueryProvider connection={connection}>
        <MemoryRouter initialEntries={["/workflows/bug_fix/versions/11"]}>
          <Routes>
            <Route path="/workflows/:workflowId" element={<SessionProbe />} />
            <Route path="/workflows/:workflowId/versions/:version" element={<SessionProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Session").textContent).toBe("bug_fix 11"));

    act(() => goTo("/workflows/bug_fix"));

    await waitFor(() => expect(screen.getByLabelText("Session").textContent).toBe("bug_fix draft"));
  });
});
