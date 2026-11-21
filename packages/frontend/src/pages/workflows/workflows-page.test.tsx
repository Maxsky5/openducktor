import { describe, expect, mock, test } from "bun:test";
import {
  agentRoleDefinitionSchema,
  type WorkflowLibrary,
  type WorkflowLibraryInputs,
  type WorkflowAvailability,
  type WorkflowTaskUse,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { createWorkspaceRecordFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { BUILTIN_ROLES } from "@openducktor/workflows";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createTaskWorkflowActionsFixture,
  createTasksStateFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { TaskWorkflowActionsContext } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { TasksStateContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceProviders } from "@/test-utils/workspace-providers";
import { WorkflowsPage } from "./workflows-page";

const builtinRole = BUILTIN_ROLES[0]!;

const library = ({
  reviewAvailability = { mode: "all" },
  defaultWorkflowId = "spec-plan-build",
}: {
  reviewAvailability?: WorkflowAvailability;
  defaultWorkflowId?: string;
} = {}): WorkflowLibrary => {
  return {
    workflows: [
      {
        id: "review-flow",
        name: "Review flow",
        states: [],
        transitionCount: 0,
        source: "custom",
        latestVersion: 2,
        draft: { problemCount: 2, warningCount: 0 },
        availability: reviewAvailability,
      },
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
        id: "idea",
        name: "Idea",
        states: [],
        transitionCount: 0,
        source: "custom",
        latestVersion: null,
        draft: { problemCount: 0, warningCount: 3 },
        availability: { mode: "all" },
      },
    ],
    roles: [
      {
        role: agentRoleDefinitionSchema.parse(builtinRole),
        source: "builtin",
        workflowIds: ["spec-plan-build", "review-flow"],
      },
    ],
    defaultWorkflowId,
  };
};

/** The workspace state of the page. A selection makes the workspace active, as the host does. */
function SwitchableWorkspace({
  initial,
  children,
}: {
  initial: ReturnType<typeof createWorkspaceStateFixture>;
  children: ReactNode;
}) {
  const [activeWorkspace, setActiveWorkspace] = useState(initial.activeWorkspace);
  const value = {
    ...initial,
    activeWorkspace,
    selectWorkspace: async (workspaceId: string) => {
      await initial.selectWorkspace(workspaceId);
      if (activeWorkspace) setActiveWorkspace({ ...activeWorkspace, workspaceId });
    },
  };
  return <WorkspaceProviders value={value}>{children}</WorkspaceProviders>;
}

/** The use of the review workflow: an open task of another repository, and a closed task. */
const otherRepoUse: WorkflowTaskUse = {
  openTasks: [
    {
      workspaceId: "other-repo",
      repoName: "Other repo",
      tasks: [
        {
          taskId: "TASK-7",
          title: "Fix the login",
          version: 2,
          issueType: { id: "bug", label: "Bug" },
          state: { id: "open", label: "Backlog" },
        },
      ],
    },
  ],
  closedTaskCount: 1,
};

const renderPage = ({
  withWorkspace,
  workflowAvailabilitySet = async () => {},
  workflowDefaultSet = async () => {},
  builtinOnly = false,
  taskUse = { openTasks: [], closedTaskCount: 0 },
  libraryOptions = {},
  tasksState = createTasksStateFixture(),
  workflowActions = createTaskWorkflowActionsFixture(),
  selectWorkspace = async () => {},
  workspaces,
}: {
  withWorkspace: boolean;
  builtinOnly?: boolean;
  workflowAvailabilitySet?: (
    input: WorkflowLibraryInputs["workflow_availability_set"],
  ) => Promise<void>;
  workflowDefaultSet?: (input: WorkflowLibraryInputs["workflow_default_set"]) => Promise<void>;
  libraryOptions?: Parameters<typeof library>[0];
  /** The tasks that use the published workflow. */
  taskUse?: WorkflowTaskUse;
  tasksState?: ReturnType<typeof createTasksStateFixture>;
  workflowActions?: ReturnType<typeof createTaskWorkflowActionsFixture>;
  selectWorkspace?: (workspaceId: string) => Promise<void>;
  /** The open repositories. The fixture has one by default. */
  workspaces?: WorkspaceRecord[];
}) => {
  const connection = createTestClientConnection({
    client: {
      workflowLibraryList: async () => {
        const value = library(libraryOptions);
        return builtinOnly
          ? { ...value, workflows: value.workflows.filter(({ source }) => source === "builtin") }
          : value;
      },
      workflowAvailabilitySet,
      workflowDefaultSet,
      workflowVersionsList: async () => [
        {
          version: 2,
          publishedAt: "2026-11-01T10:00:00Z",
          taskCount:
            taskUse.closedTaskCount +
            taskUse.openTasks.reduce((sum, group) => sum + group.tasks.length, 0),
        },
      ],
      workflowTaskUseGet: async () => taskUse,
    },
  });
  const overrides: Parameters<typeof createWorkspaceStateFixture>[0] = withWorkspace
    ? { selectWorkspace }
    : { activeWorkspace: null };
  if (workspaces) overrides.workspaces = workspaces;
  const workspace = createWorkspaceStateFixture(overrides);
  return render(
    <QueryProvider connection={connection}>
      <SwitchableWorkspace initial={workspace}>
        <TasksStateContext value={tasksState}>
          <TaskWorkflowActionsContext value={workflowActions}>
            <MemoryRouter>
              <WorkflowsPage />
            </MemoryRouter>
          </TaskWorkflowActionsContext>
        </TasksStateContext>
      </SwitchableWorkspace>
    </QueryProvider>,
  );
};

const rows = () =>
  within(screen.getByRole("region", { name: "Workflow list" })).getAllByRole("listitem");

/** Opens the "…" menu of a row and returns its command by label. */
const menuCommand = async (rowName: string, command: string) => {
  const trigger = await screen.findByRole("button", { name: `Actions for ${rowName}` });
  fireEvent.keyDown(trigger, { key: "Enter" });
  await screen.findByRole("menu");
  return screen.queryByRole("menuitem", { name: command });
};

const closeMenu = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("WorkflowsPage", () => {
  test("lists the built-in workflow first, then the custom workflows with their status", async () => {
    renderPage({ withWorkspace: false });
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [builtin, idea, review] = rows();
    expect(builtin!.textContent).toContain("Spec, Plan, Build");
    expect(builtin!.textContent).toContain("Built-in");
    expect(idea!.textContent).toContain("Draft");
    expect(idea!.textContent).toContain("3 to check");
    expect(review!.textContent).toContain("Version 2 · Unpublished changes");
    expect(review!.textContent).toContain("2 problems to fix");
  });

  test("gives every custom workflow the same actions, with Export off until a version exists", async () => {
    renderPage({ withWorkspace: false });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(await menuCommand("Spec, Plan, Build", "Export as YAML")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "View" })).toBeTruthy();
    closeMenu();
    const ideaExport = await menuCommand("Idea", "Export as YAML Publish a version first.");
    expect(ideaExport?.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open in the editor" })).toBeTruthy();
    closeMenu();
    const reviewExport = await menuCommand("Review flow", "Export as YAML");
    expect(reviewExport?.hasAttribute("data-disabled")).toBe(false);
  });

  test("shows where each workflow is available, with or without a selected repository", async () => {
    renderPage({
      withWorkspace: false,
      libraryOptions: { reviewAvailability: { mode: "except", workspaceIds: ["workspace-1"] } },
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [builtin, idea, review] = rows();
    expect(builtin!.textContent).toContain("All repositories");
    expect(idea!.textContent).toContain("All repositories");
    expect(review!.textContent).toContain("All except OpenDucktor");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  test("marks the default, and offers Make default only to a published workflow for all", async () => {
    renderPage({
      withWorkspace: true,
      libraryOptions: { reviewAvailability: { mode: "only", workspaceIds: ["workspace-1"] } },
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[0]!.textContent).toContain("Default");
    expect(await menuCommand("Spec, Plan, Build", "Make it the default")).toBeNull();
    closeMenu();
    const idea = await menuCommand("Idea", "Make it the default Publish a version first.");
    expect(idea?.hasAttribute("data-disabled")).toBe(true);
    closeMenu();
    const review = await menuCommand(
      "Review flow",
      "Make it the default Make it available to all repositories first.",
    );
    expect(review?.hasAttribute("data-disabled")).toBe(true);
  });

  test("limits a workflow to the repositories that the user checks", async () => {
    const workflowAvailabilitySet = mock(
      async (_input: WorkflowLibraryInputs["workflow_availability_set"]) => {},
    );
    renderPage({ withWorkspace: true, workflowAvailabilitySet });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Availability of Review flow: All repositories. Change it",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Only these/ }));
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /OpenDucktor/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(workflowAvailabilitySet).toHaveBeenCalledTimes(1));
    expect(workflowAvailabilitySet.mock.calls[0]![0]).toEqual({
      workflowId: "review-flow",
      availability: { mode: "only", workspaceIds: ["workspace-1"] },
    });
  });

  test("searches a long list of repositories by name", async () => {
    const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
    renderPage({
      withWorkspace: true,
      workspaces: names.map((name) =>
        createWorkspaceRecordFixture({
          workspaceId: name,
          workspaceName: name,
          repoPath: `/code/${name}`,
        }),
      ),
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Availability of Review flow: All repositories. Change it",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Only these/ }));
    const search = within(dialog).getByLabelText("Search repositories");
    const repositories = () =>
      within(dialog)
        .getAllByRole("checkbox")
        .filter((box) => box !== within(dialog).getByRole("checkbox", { name: /^Select all/ }));
    expect(repositories()).toHaveLength(7);
    fireEvent.change(search, { target: { value: "ETA" } });
    // Beta, zeta, and eta.
    expect(repositories()).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select all shown" }));
    expect(dialog.textContent).toContain("3 of 7 checked");
    fireEvent.change(search, { target: { value: "zeta" } });
    expect(within(dialog).getByRole("checkbox", { name: /zeta/ })).toBeTruthy();
    expect(repositories()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "nothing" } });
    expect(dialog.textContent).toContain("No repository matches “nothing”.");
    fireEvent.change(search, { target: { value: "" } });
    const selectAll = within(dialog).getByRole("checkbox", { name: "Select all" });
    expect(selectAll.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(selectAll);
    expect(dialog.textContent).toContain("7 of 7 checked");
    fireEvent.click(selectAll);
    expect(dialog.textContent).toContain("0 of 7 checked");
  });

  test("keeps a separate list for Only these and All except these", async () => {
    renderPage({
      withWorkspace: true,
      libraryOptions: { reviewAvailability: { mode: "only", workspaceIds: ["workspace-1"] } },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Availability of Review flow: Only OpenDucktor. Change it",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const repository = () => within(dialog).getByRole("checkbox", { name: /OpenDucktor/ });
    expect(repository().getAttribute("data-state")).toBe("checked");
    fireEvent.click(within(dialog).getByRole("radio", { name: /All except these/ }));
    expect(repository().getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Only these/ }));
    expect(repository().getAttribute("data-state")).toBe("checked");
  });

  test("keeps the default workflow available to every repository", async () => {
    renderPage({ withWorkspace: true });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Availability of Spec, Plan, Build: All repositories. Change it",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getByRole("radio", { name: /Only these/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(dialog.textContent).toContain("Make another workflow the default to limit it.");
  });

  test("makes a workflow the default from its menu", async () => {
    const workflowDefaultSet = mock(
      async (_input: WorkflowLibraryInputs["workflow_default_set"]) => {},
    );
    renderPage({ withWorkspace: true, workflowDefaultSet });
    fireEvent.click((await menuCommand("Review flow", "Make it the default"))!);
    await waitFor(() =>
      expect(workflowDefaultSet).toHaveBeenCalledWith({ workflowId: "review-flow" }),
    );
  });

  test("explains a workflow and opens the new workflow form while no custom workflow exists", async () => {
    renderPage({ withWorkspace: false, builtinOnly: true });
    const card = await screen.findByRole("region", { name: "Make a workflow of your own" });
    for (const step of ["1. Columns", "2. Transitions", "3. Agents", "4. Publish"])
      expect(within(card).getByText(step)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "New workflow" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /Copy of Spec, Plan, Build/ })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: /Blank workflow/ })).toBeTruthy();
  });

  test("shows no empty-state card when a custom workflow exists", async () => {
    renderPage({ withWorkspace: false });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByRole("region", { name: "Make a workflow of your own" })).toBeNull();
  });

  test("names each open task that stops the delete, with its repository and its state", async () => {
    renderPage({ withWorkspace: true, taskUse: otherRepoUse });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("1 open task uses it. Close or delete it first.");
    const tasks = await within(dialog).findByRole("region", { name: "Open tasks in Other repo" });
    expect(tasks.textContent).toContain("Fix the login");
    expect(tasks.textContent).toContain("Backlog");
    expect(tasks.textContent).toContain("TASK-7");
    expect(within(dialog).queryByRole("button", { name: "Delete workflow" })).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  test("deletes a workflow that only closed tasks use, and keeps their versions", async () => {
    renderPage({ withWorkspace: true, taskUse: { openTasks: [], closedTaskCount: 2 } });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "Delete workflow" })).toBeTruthy();
    expect(dialog.textContent).toContain(
      "Delete this workflow. Its closed tasks keep the versions that they use.",
    );
    expect(dialog.textContent).toContain("Keep its 1 published version for 2 closed tasks");
    expect(dialog.textContent).not.toContain("Delete its 1 published version");
  });

  test("opens the details of a task of this repository on the same page", async () => {
    const onOpenTaskDetails = mock((_taskId: string) => {});
    const selectWorkspace = mock(async (_workspaceId: string) => {});
    const taskUse: WorkflowTaskUse = {
      openTasks: [{ ...otherRepoUse.openTasks[0]!, workspaceId: "workspace-1" }],
      closedTaskCount: 0,
    };
    renderPage({
      withWorkspace: true,
      taskUse,
      selectWorkspace,
      workflowActions: createTaskWorkflowActionsFixture({ onOpenTaskDetails }),
    });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Open task Fix the login" }));
    expect(onOpenTaskDetails).toHaveBeenCalledWith("TASK-7");
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Workflow list" })).toBeTruthy();
  });

  test("selects the repository of a task of another repository, then opens its details", async () => {
    const onOpenTaskDetails = mock((_taskId: string) => {});
    const selectWorkspace = mock(async (_workspaceId: string) => {});
    renderPage({
      withWorkspace: true,
      taskUse: otherRepoUse,
      selectWorkspace,
      workflowActions: createTaskWorkflowActionsFixture({ onOpenTaskDetails }),
    });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Open task Fix the login" }));
    expect(selectWorkspace).toHaveBeenCalledWith("other-repo");
    await waitFor(() => expect(onOpenTaskDetails).toHaveBeenCalledWith("TASK-7"));
    expect(screen.getByRole("region", { name: "Workflow list" })).toBeTruthy();
  });

  test("stops the delete of the default workflow", async () => {
    renderPage({ withWorkspace: true, libraryOptions: { defaultWorkflowId: "review-flow" } });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "It is the default workflow. Make another workflow the default first.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Delete workflow" })).toBeNull();
  });

  test("lets a workflow that nothing uses be deleted", async () => {
    renderPage({ withWorkspace: true });
    fireEvent.click((await menuCommand("Review flow", "Delete"))!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("This cannot be undone."));
    expect(
      (await within(dialog).findByRole("region", { name: "What changes" })).textContent,
    ).toContain("Delete the workflow");
    expect(
      within(dialog).getByRole("button", { name: "Delete workflow" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  test("lists workflow roles with the workflows that use them", async () => {
    renderPage({ withWorkspace: false });
    await waitFor(() => expect(screen.getByText("Workflow roles")).toBeTruthy());
    // Each workflow name is its own chip, since a name can hold a comma.
    const roles = screen.getByRole("region", { name: "Workflow roles" });
    expect(within(roles).getAllByText("Spec, Plan, Build").length).toBeGreaterThan(0);
    expect(within(roles).getAllByText("Review flow").length).toBeGreaterThan(0);
    expect(await menuCommand(builtinRole.label, "View")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });
});
