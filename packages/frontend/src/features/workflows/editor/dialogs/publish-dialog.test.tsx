import { describe, expect, mock, test } from "bun:test";
import type { WorkflowDocument, WorkflowLibrary } from "@openducktor/contracts";
import {
  createTestClientConnection,
  type TestClientConnectionOptions,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { newWorkflowDocument } from "@openducktor/workflows";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import { createWorkspaceStateFixture } from "@/test-utils/shared-test-fixtures";
import { WorkspaceProviders } from "@/test-utils/workspace-providers";
import { EditorContext, type EditorEnvironment } from "../editor-context";
import { addEvent, addState } from "../model/create-elements";
import type { EditorCheckContext } from "../model/editor-derivation";
import { createViewOf } from "../use-editor-derivation";
import { createEditorStore } from "../model/editor-store";
import { type PublishRequest, PublishDialog } from "./publish-dialog";
import { VersionsDialog } from "./versions-dialog";

const CONTEXT: EditorCheckContext = {
  roles: builtinCompiledCatalogFixture.roles,
  otherWorkflows: [],
  takenWorkflowIds: new Set(),
  sharedStateIds: new Set(),
  sharedStates: new Map(),
};

const library: WorkflowLibrary = {
  workflows: [
    {
      id: "spec-plan-build",
      name: "Spec, Plan, Build",
      states: [],
      transitionCount: 0,
      source: "builtin",
      latestVersion: null,
      draft: null,
      availability: { mode: "all" },
    },
    {
      id: "flow",
      name: "Flow",
      states: [],
      transitionCount: 0,
      source: "custom",
      latestVersion: null,
      draft: { problemCount: 1, warningCount: 0 },
      availability: { mode: "except", workspaceIds: ["workspace-1"] },
    },
  ],
  roles: [],
  defaultWorkflowId: "spec-plan-build",
};

function Editor({
  document,
  children,
}: {
  document: WorkflowDocument;
  children: ReactElement;
}): ReactElement {
  const store = createEditorStore(
    { workflowId: "flow", document, readOnly: false, hasDraft: true, viewPositions: {} },
    { saveDraft: async (workflowId) => ({ workflowId }) },
  );
  const environment: EditorEnvironment = {
    store,
    viewOf: createViewOf(CONTEXT, true),
    catalogRoles: [],
    roles: { newRole: () => {}, editRole: () => {}, duplicateRole: () => {} },
    published: false,
    takenWorkflowIds: new Set(),
    sharedStates: new Map(),
  };
  return <EditorContext value={environment}>{children}</EditorContext>;
}

const renderWithHost = (
  children: ReactElement,
  client: NonNullable<TestClientConnectionOptions["client"]>,
  document = addEvent(newWorkflowDocument("flow", "Flow"), "open", "closed", "finish").document,
) =>
  render(
    <QueryProvider connection={createTestClientConnection({ client })}>
      <WorkspaceProviders value={createWorkspaceStateFixture()}>
        <MemoryRouter>
          <Editor document={document}>{children}</Editor>
        </MemoryRouter>
      </WorkspaceProviders>
    </QueryProvider>,
  );

describe("publish dialog", () => {
  test("lists the warnings, says Publish anyway, and shows where the workflow is available", async () => {
    const onPublish = mock(async (_request: PublishRequest) => {});
    const workflowTaskMovesGet = mock(async () => []);
    renderWithHost(
      <PublishDialog
        open
        onOpenChange={() => {}}
        workflowId="flow"
        latestVersion={null}
        onPublish={onPublish}
      />,
      { workflowLibraryList: async () => library, workflowTaskMovesGet },
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 to check")).toBeTruthy();
    expect(await within(dialog).findByText(/Available in: All except OpenDucktor\./)).toBeTruthy();
    // No task can be on an older version before the first publication.
    expect(within(dialog).queryByText("Move tasks from older versions")).toBeNull();
    expect(workflowTaskMovesGet).not.toHaveBeenCalled();
    const publish = await within(dialog).findByRole("button", { name: "Publish anyway" });
    await waitFor(() => expect(publish.hasAttribute("disabled")).toBe(false));
    fireEvent.click(publish);
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    // The selected repository is left out, so the success toast offers no new task there.
    expect(onPublish.mock.calls[0]![0]).toEqual({ moveTasks: [], usableHere: false });
  });
});

describe("publish dialog with shared columns", () => {
  test("names the columns that another workflow shares by state ID", async () => {
    const withTriage = addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
    const bugTriage = {
      ...library.workflows[1]!,
      id: "bug-triage",
      name: "Bug triage",
      states: [{ id: "triage", label: "Triage" }],
    };
    renderWithHost(
      <PublishDialog
        open
        onOpenChange={() => {}}
        workflowId="flow"
        latestVersion={null}
        onPublish={async () => {}}
      />,
      {
        workflowLibraryList: async () => ({
          ...library,
          workflows: [...library.workflows, bugTriage],
        }),
        workflowTaskMovesGet: async () => [],
      },
      withTriage,
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/The column “Triage” is shared with\s+Bug triage\./),
    ).toBeTruthy();
    // The new state took a colour that the draft of Bug triage does not show.
    expect(
      within(dialog).getByText(/The draft of Bug triage shows “Triage” another way\./),
    ).toBeTruthy();
  });
});

describe("publish dialog after a publication", () => {
  test("lists the tasks on older versions", async () => {
    renderWithHost(
      <PublishDialog
        open
        onOpenChange={() => {}}
        workflowId="flow"
        latestVersion={2}
        onPublish={async () => {}}
      />,
      { workflowLibraryList: async () => library, workflowTaskMovesGet: async () => [] },
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Move tasks from older versions")).toBeTruthy();
    expect(await within(dialog).findByText("No open task uses an older version.")).toBeTruthy();
  });
});

describe("versions dialog", () => {
  test("keeps Move tasks off while no task uses an older version", async () => {
    renderWithHost(
      <VersionsDialog open onOpenChange={() => {}} workflowId="flow" latestVersion={2} />,
      {
        workflowVersionsList: async () => [
          { version: 2, publishedAt: "2026-11-02T10:00:00Z", taskCount: 4 },
          { version: 1, publishedAt: "2026-11-01T10:00:00Z", taskCount: 0 },
        ],
      },
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("4 tasks")).toBeTruthy();
    // The footer shows after the minimum loader time of the dialog.
    const move = await within(dialog).findByRole("button", {
      name: "Move tasks to latest version",
    });
    expect(move.hasAttribute("disabled")).toBe(true);
    expect(
      within(dialog).getByText("No task uses an older version, so no task can move."),
    ).toBeTruthy();
  });
});
