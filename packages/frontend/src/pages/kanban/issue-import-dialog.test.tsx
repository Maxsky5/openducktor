import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  type IssueItemsImportInput,
  type IssueItemsImportResult,
  type IssueItemsListInput,
  type RepositoryGitProviderContext,
  type SourceIssue,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { createQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/shared/host";
import { invalidateRepoIssueItemsQueries, issueItemsQueryKeys } from "@/state/queries/issue-items";
import { enableReactActEnvironment } from "../agents/agent-studio-test-utils";
import { IssueImportDialog } from "./issue-import-dialog";
import { useIssueSelectionState } from "./issue-import-dialog-state";

enableReactActEnvironment();

const provider = {
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
  config: {
    id: "github",
    enabled: true,
    autoDetected: false,
    repository: { host: "github.com", owner: "example", name: "repo" },
  },
  health: {
    providerId: "github",
    enabled: true,
    available: true,
    executablePath: "gh",
    version: "2.0",
    authenticated: true,
    account: "octocat",
    repositoryMappingValid: true,
  },
} satisfies NonNullable<RepositoryGitProviderContext>;

const azureProvider = {
  descriptor: AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  config: {
    id: "azure_devops",
    enabled: true,
    autoDetected: false,
    repository: {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "example",
      project: "app",
      name: "repo",
    },
    settings: { areaPath: "app\\Team A" },
  },
  health: { ...provider.health, providerId: "azure_devops" },
} satisfies NonNullable<RepositoryGitProviderContext>;

const issue = (id: string): SourceIssue => ({
  providerId: "github",
  scope: "github.com/example/repo",
  sourceId: id,
  number: id,
  url: `https://github.com/example/repo/issues/${id}`,
  title: `Issue ${id}`,
  description: `Body ${id}`,
  creator: "octocat",
  updatedAt: "2026-09-23T00:00:00Z",
  tags: ["triage"],
  revision: "1",
});

const reviewCard = (title: string) => screen.getByRole("region", { name: `Review ${title}` });

const chooseIssueType = (title: string, type: "Task" | "Feature" | "Bug"): void => {
  fireEvent.click(within(reviewCard(title)).getByRole("button", { name: "Issue type" }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${type}`) }));
};

const addReviewLabel = (title: string, label: string): void => {
  const input = within(reviewCard(title)).getByRole("textbox");
  fireEvent.change(input, { target: { value: label } });
  fireEvent.keyDown(input, { key: "Enter" });
};

const replaceReviewLabel = (title: string, oldLabel: string, newLabel: string): void => {
  fireEvent.click(
    within(reviewCard(title)).getByRole("button", { name: `Remove label ${oldLabel}` }),
  );
  addReviewLabel(title, newLabel);
};

const originalList = host.issueItemsList;
const originalGet = host.issueItemGet;
const originalImport = host.issueItemsImport;
const originalImageGet = host.issueImageGet;

afterEach(() => {
  host.issueItemsList = originalList;
  host.issueItemGet = originalGet;
  host.issueItemsImport = originalImport;
  host.issueImageGet = originalImageGet;
});

describe("Issue import dialog", () => {
  test("keeps selection and review together across batched toggles", () => {
    const { result } = renderHook(() => useIssueSelectionState());

    act(() => {
      result.current.toggleItem(issue("1"));
      result.current.toggleItem(issue("1"));
    });

    expect(result.current.selected.size).toBe(0);
    expect(result.current.reviews.size).toBe(0);
  });

  test("closes after every selected issue is created and reports the count", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1"), issue("2")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    host.issueItemsImport = async () => ({
      results: [
        { sourceId: "1", outcome: "created", taskId: "TASK-1" },
        { sourceId: "2", outcome: "created", taskId: "TASK-2" },
      ],
    });
    const imported = mock(() => {});
    const onOpenChange = mock((_open: boolean) => {});
    const success = spyOn(toast, "success").mockImplementation(() => "toast-id");
    try {
      const view = render(
        <QueryClientProvider client={createQueryClient()}>
          <SettingsModalProvider>
            <IssueImportDialog
              open
              onOpenChange={onOpenChange}
              repoPath="/repo"
              provider={provider}
              onImported={imported}
            />
          </SettingsModalProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Issue 2" }));
      fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
      fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(imported).toHaveBeenCalledTimes(1);
      expect(success).toHaveBeenCalledWith("2 Tasks created");
      view.unmount();
    } finally {
      success.mockRestore();
    }
  });

  test("loads a private GitHub image through the host in review", async () => {
    const url = "https://github.com/user-attachments/assets/cda6c6b0-48b1-4d49-b8f2-78a1bd758be9";
    host.issueItemsList = async () => ({
      items: [{ ...issue("132"), description: `![Screenshot](${url})` }],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const imageGet = mock(async () => ({
      mediaType: "image/png" as const,
      bytesBase64: "aGVsbG8=",
    }));
    host.issueImageGet = imageGet;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 132" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Screenshot" }).getAttribute("src")).toBe(
        "data:image/png;base64,aGVsbG8=",
      ),
    );
    expect(imageGet).toHaveBeenCalledWith({ repoPath: "/repo", sourceId: "132", url });
    view.unmount();
  });

  test("lists browse-only provider issues without search controls", async () => {
    const list = mock(async (_input: IssueItemsListInput) => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: false,
      incompleteResults: false,
    }));
    host.issueItemsList = list;
    const browseProvider = {
      ...provider,
      descriptor: {
        ...provider.descriptor,
        capabilities: { ...provider.descriptor.capabilities, issueAccess: "browse" as const },
      },
    };
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={browseProvider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("checkbox", { name: "Select Issue 1" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Search issues" })).toBeNull();
    expect(list.mock.calls[0]?.[0].search).toBe("");
    view.unmount();
  });

  test("selects an issue when its title is clicked", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    const checkbox = await screen.findByRole("checkbox", { name: "Select Issue 1" });
    fireEvent.click(screen.getByText("Issue 1"));
    expect(checkbox.getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("Selected (1)")).toBeDefined();
    view.unmount();
  });

  test("keeps search and results in one panel and marks linked issues as unavailable", async () => {
    host.issueItemsList = async () => ({
      items: [{ ...issue("132"), linkedTaskId: "TASK-132" }, issue("131")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    const linkedCheckbox = await screen.findByRole<HTMLButtonElement>("checkbox", {
      name: "Select Issue 132",
    });
    const panel = screen.getByRole("list", { name: "Open source items" }).parentElement;
    expect(panel?.contains(screen.getByRole("textbox", { name: "Search issues" }))).toBe(true);
    expect(linkedCheckbox.disabled).toBe(true);
    expect(within(linkedCheckbox.closest("li")!).getByText("Linked")).toBeTruthy();
    expect(screen.queryByText("Already linked to Task TASK-132")).toBeNull();
    fireEvent.click(within(linkedCheckbox.closest("li")!).getByText("Issue 132"));
    expect(linkedCheckbox.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByRole("button", { name: "Review Tasks" }).hasAttribute("disabled")).toBe(
      true,
    );
    view.unmount();
  });

  test("shows a readable Markdown description during review", async () => {
    host.issueItemsList = async () => ({
      items: [
        {
          ...issue("1"),
          description:
            "**Details**\n\n[View image](https://github.com/user-attachments/assets/abc)",
        },
      ],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    expect(within(reviewCard("Issue 1")).getByText("Details").tagName).toBe("STRONG");
    expect(within(reviewCard("Issue 1")).getByRole("link", { name: "View image" })).toBeDefined();
    view.unmount();
  });

  for (const scenario of [
    {
      name: "repository",
      original: provider,
      changed: {
        ...provider,
        config: {
          ...provider.config,
          repository: { ...provider.config.repository, name: "other-repo" },
        },
      },
    },
    {
      name: "Azure area path",
      original: azureProvider,
      changed: {
        ...azureProvider,
        config: { ...azureProvider.config, settings: { areaPath: "app\\Team B" } },
      },
    },
  ]) {
    test(`loads the new issue list when the configured ${scenario.name} changes`, async () => {
      const list = mock(async () => ({
        items: [issue(list.mock.calls.length === 1 ? "1" : "2")],
        nextCursor: undefined,
        searchSupported: true,
        incompleteResults: false,
      }));
      host.issueItemsList = list;
      const queryClient = createQueryClient();
      const renderDialog = (current: NonNullable<RepositoryGitProviderContext>) => (
        <QueryClientProvider client={queryClient}>
          <SettingsModalProvider>
            <IssueImportDialog
              key={JSON.stringify(current.config)}
              open
              onOpenChange={() => {}}
              repoPath="/repo"
              provider={current}
              onImported={() => {}}
            />
          </SettingsModalProvider>
        </QueryClientProvider>
      );
      const view = render(renderDialog(scenario.original));
      expect(await screen.findByRole("checkbox", { name: "Select Issue 1" })).toBeDefined();

      view.rerender(renderDialog(scenario.changed));
      expect(await screen.findByRole("checkbox", { name: "Select Issue 2" })).toBeDefined();
      expect(screen.queryByRole("checkbox", { name: "Select Issue 1" })).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      view.unmount();
    });
  }

  test("keeps comma-bearing source labels intact while editing labels", async () => {
    host.issueItemsList = async () => ({
      items: [{ ...issue("1"), tags: ["ui,ux", "backend"] }],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const importItems = mock(async (_input: IssueItemsImportInput) => ({
      results: [{ sourceId: "1", outcome: "created" as const, taskId: "TASK-1" }],
    }));
    host.issueItemsImport = importItems;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    expect(within(reviewCard("Issue 1")).getByText("ui,ux")).toBeDefined();
    replaceReviewLabel("Issue 1", "backend", "api");
    const labelInput = within(reviewCard("Issue 1")).getByRole("textbox");
    fireEvent.change(labelInput, { target: { value: "docs" } });
    fireEvent.keyDown(labelInput, { key: "," });
    expect(within(reviewCard("Issue 1")).queryByText("docs")).toBeNull();
    addReviewLabel("Issue 1", "docs,ux");
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Created Task TASK-1");
    expect(importItems.mock.calls[0]?.[0].items[0]?.labels).toEqual(["ui,ux", "api", "docs,ux"]);
    view.unmount();
  });

  test("shows only success after the new Task appears in refreshed issue results", async () => {
    const list = mock(async () => {
      const item = issue("1");
      if (list.mock.calls.length > 1) item.linkedTaskId = "TASK-1";
      return {
        items: [item],
        nextCursor: undefined,
        searchSupported: true,
        incompleteResults: false,
      };
    });
    const importItems = mock(async (_input: IssueItemsImportInput) => ({
      results: [{ sourceId: "1", outcome: "created" as const, taskId: "TASK-1" }],
    }));
    host.issueItemsList = list;
    host.issueItemsImport = importItems;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(within(reviewCard("Issue 1")).getByText("Created Task TASK-1")).toBeDefined();
    expect(within(reviewCard("Issue 1")).getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("Already linked to Task TASK-1")).toBeNull();
    expect(importItems).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test("keeps each review edit after returning to selection", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1"), issue("2")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const importItems = mock(async (_input: IssueItemsImportInput) => ({ results: [] }));
    host.issueItemsImport = importItems;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Issue 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    chooseIssueType("Issue 1", "Bug");
    replaceReviewLabel("Issue 1", "triage", "frontend");
    fireEvent.click(within(reviewCard("Issue 2")).getByRole("button", { name: "Priority" }));
    fireEvent.click(screen.getByRole("option", { name: /P1 · High/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));

    expect(
      within(reviewCard("Issue 1")).getByRole("button", { name: "Issue type" }).textContent,
    ).toContain("Bug");
    expect(within(reviewCard("Issue 1")).getByText("frontend")).toBeDefined();
    expect(
      within(reviewCard("Issue 2")).getByRole("button", { name: "Issue type" }).textContent,
    ).toContain("Task");
    expect(within(reviewCard("Issue 2")).getByText("triage")).toBeDefined();
    expect(
      within(reviewCard("Issue 2")).getByRole("button", { name: "Priority" }).textContent,
    ).toContain("P1");
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() => expect(importItems).toHaveBeenCalledTimes(1));
    expect(importItems.mock.calls[0]?.[0].items).toMatchObject([
      { sourceId: "1", issueType: "bug", labels: ["frontend"] },
      { sourceId: "2", issueType: "task", priority: 1, labels: ["triage"] },
    ]);
    view.unmount();
  });

  for (const removal of ["checkbox", "selected chip"] as const) {
    test(`starts a new review after removal by ${removal}`, async () => {
      host.issueItemsList = async () => ({
        items: [issue("1")],
        nextCursor: undefined,
        searchSupported: true,
        incompleteResults: false,
      });
      const view = render(
        <QueryClientProvider client={createQueryClient()}>
          <SettingsModalProvider>
            <IssueImportDialog
              open
              onOpenChange={() => {}}
              repoPath="/repo"
              provider={provider}
              onImported={() => {}}
            />
          </SettingsModalProvider>
        </QueryClientProvider>,
      );

      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
      chooseIssueType("Issue 1", "Bug");
      replaceReviewLabel("Issue 1", "triage", "reviewed");
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      fireEvent.click(
        removal === "checkbox"
          ? screen.getByRole("checkbox", { name: "Select Issue 1" })
          : screen.getByRole("button", { name: "Remove Issue 1" }),
      );
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Issue 1" }));
      fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));

      expect(
        within(reviewCard("Issue 1")).getByRole("button", { name: "Issue type" }).textContent,
      ).toContain("Task");
      expect(within(reviewCard("Issue 1")).getByText("triage")).toBeDefined();
      view.unmount();
    });
  }

  test("starts with a fresh selection when reopened", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const queryClient = createQueryClient();
    const renderDialog = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <SettingsModalProvider>
          <IssueImportDialog
            open={open}
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>
    );
    const view = render(renderDialog(true));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    chooseIssueType("Issue 1", "Bug");

    view.rerender(renderDialog(false));
    view.rerender(renderDialog(true));

    expect(
      (await screen.findByRole("checkbox", { name: "Select Issue 1" })).getAttribute("data-state"),
    ).toBe("unchecked");
    expect(screen.queryByText("Selected (1)")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search issues" })).toHaveProperty("value", "");
    view.unmount();
  });

  test("clears a failed import outcome when its item is removed and selected again", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const importItems = mock(
      async (_input: IssueItemsImportInput): Promise<IssueItemsImportResult> => ({
        results:
          importItems.mock.calls.length === 1
            ? [{ sourceId: "1", outcome: "failed", reason: "Provider request failed. Retry." }]
            : [{ sourceId: "1", outcome: "created", taskId: "TASK-1" }],
      }),
    );
    host.issueItemsImport = importItems;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    chooseIssueType("Issue 1", "Bug");
    replaceReviewLabel("Issue 1", "triage", "reviewed");
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Provider request failed. Retry.");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));

    expect(screen.queryByText("Provider request failed. Retry.")).toBeNull();
    expect(
      within(reviewCard("Issue 1")).getByRole("button", { name: "Issue type" }).textContent,
    ).toContain("Task");
    expect(within(reviewCard("Issue 1")).getByText("triage")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Created Task TASK-1");
    expect(importItems.mock.calls[1]?.[0].items).toMatchObject([
      { sourceId: "1", issueType: "task", priority: 2, labels: ["triage"] },
    ]);
    view.unmount();
  });

  test("keeps a review item in place while its import is pending", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    let finishImport!: (result: IssueItemsImportResult) => void;
    host.issueItemsImport = () =>
      new Promise<IssueItemsImportResult>((resolve) => {
        finishImport = resolve;
      });
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByRole("button", { name: "Importing..." });
    expect(screen.getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(true);

    finishImport({ results: [] });
    await screen.findByRole("button", { name: "Import selected" });
    view.unmount();
  });

  test("keeps selections when paging through source items", async () => {
    host.issueItemsList = async (input: IssueItemsListInput) => ({
      items: [issue(input.cursor ? "2" : "1")],
      nextCursor: input.cursor ? undefined : "page-2",
      searchSupported: true,
      incompleteResults: false,
    });
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 2" }));
    expect(screen.getByText("Selected (2)")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    expect(within(reviewCard("Issue 1")).getByText("triage")).toBeDefined();
    expect(within(reviewCard("Issue 2")).getByText("triage")).toBeDefined();
    view.unmount();
  });

  test("keeps selections across searches and retries only failed items", async () => {
    const list = mock(async (input: IssueItemsListInput) => ({
      items: input.search ? [issue("2")] : [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    }));
    const outcomes: IssueItemsImportResult[] = [
      {
        results: [
          { sourceId: "1", outcome: "created", taskId: "TASK-1" },
          { sourceId: "2", outcome: "failed", reason: "Provider request failed. Retry." },
        ],
      },
      { results: [{ sourceId: "2", outcome: "created", taskId: "TASK-2" }] },
    ];
    const imported = mock(async () => {});
    const onOpenChange = mock((_open: boolean) => {});
    const importItems = mock(async (_input: IssueItemsImportInput) => outcomes.shift()!);
    host.issueItemsList = list;
    host.issueItemsImport = importItems;

    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={onOpenChange}
            repoPath="/repo"
            provider={provider}
            onImported={imported}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search issues" }), {
      target: { value: "second" },
    });
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 2" }));
    expect(screen.getByText("Selected (2)")).toBeDefined();
    expect(screen.queryByText("2 selected")).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      (await screen.findByRole("checkbox", { name: "Select Issue 1" })).getAttribute("data-state"),
    ).toBe("checked");
    expect(screen.getByText("Selected (2)")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    chooseIssueType("Issue 1", "Bug");
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Created Task TASK-1");
    expect(screen.getByText("Provider request failed. Retry.")).toBeDefined();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(importItems.mock.calls[0]?.[0].items.map((item) => item.sourceId)).toEqual(["1", "2"]);

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Created Task TASK-2");
    expect(importItems.mock.calls[1]?.[0].items.map((item) => item.sourceId)).toEqual(["2"]);
    await waitFor(() => expect(imported).toHaveBeenCalledTimes(2));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(list.mock.calls.some(([input]) => input.search === "second")).toBe(true);
    view.unmount();
  });

  test("refreshes a changed item outside the current search before retry", async () => {
    host.issueItemsList = async (input: IssueItemsListInput) => ({
      items: [issue(input.search ? "2" : "1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    const get = mock(async () => ({
      ...issue("1"),
      revision: "2",
      title: "Updated issue",
      description: "New body",
    }));
    const importItems = mock(
      async (_input: IssueItemsImportInput): Promise<IssueItemsImportResult> => ({
        results:
          importItems.mock.calls.length === 1
            ? [
                {
                  sourceId: "1",
                  outcome: "failed",
                  reason: "The source item changed since review. Refresh it.",
                },
              ]
            : [{ sourceId: "1", outcome: "created", taskId: "TASK-1" }],
      }),
    );
    host.issueItemGet = get;
    host.issueItemsImport = importItems;
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search issues" }), {
      target: { value: "other" },
    });
    await screen.findByRole("checkbox", { name: "Select Issue 2" });
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    chooseIssueType("Issue 1", "Bug");
    replaceReviewLabel("Issue 1", "triage", "reviewed");
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("The source item changed since review. Refresh it.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh item" }));
    await screen.findByText("New body");
    expect(screen.getByText("#1 Updated issue")).toBeDefined();
    expect(
      within(reviewCard("Updated issue")).getByRole("button", { name: "Issue type" }).textContent,
    ).toContain("Bug");
    expect(within(reviewCard("Updated issue")).getByText("reviewed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Created Task TASK-1");
    expect(get).toHaveBeenCalledWith({ repoPath: "/repo", sourceId: "1" });
    expect(importItems.mock.calls[1]?.[0].items).toMatchObject([
      { sourceId: "1", revision: "2", issueType: "bug", labels: ["reviewed"] },
    ]);
    view.unmount();
  });

  test("keeps a closed item failure after refresh rejects it", async () => {
    host.issueItemsList = async () => ({
      items: [issue("1")],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    });
    host.issueItemsImport = async () => ({
      results: [{ sourceId: "1", outcome: "failed", reason: "Changed since review." }],
    });
    host.issueItemGet = async () => {
      throw new Error("Issue 1 is closed. Remove it from the selection.");
    };
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByText("Changed since review.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh item" }));
    await screen.findByText("Issue 1 is closed. Remove it from the selection.");
    expect(screen.getByText("#1 Issue 1")).toBeDefined();
    view.unmount();
  });

  test("stops a selected item from import when a fresh list reports its Task link", async () => {
    let linked = false;
    host.issueItemsList = async () => {
      const source = issue("1");
      if (linked) source.linkedTaskId = "TASK-1";
      return {
        items: [source],
        nextCursor: undefined,
        searchSupported: true,
        incompleteResults: false,
      };
    };
    host.issueItemsImport = mock(async () => ({ results: [] }));
    const queryClient = createQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <SettingsModalProvider>
          <IssueImportDialog
            open
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={provider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Issue 1" }));
    linked = true;
    await queryClient.invalidateQueries({ queryKey: issueItemsQueryKeys.repo("/repo") });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review Tasks" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(screen.getByTitle("Linked to Task TASK-1")).toBeDefined();
    view.unmount();
  });

  test("refreshes an Azure work item after its deleted Task link is invalidated", async () => {
    let linked = true;
    const list = mock(async () => ({
      items: [
        {
          ...issue("1"),
          providerId: "azure_devops" as const,
          linkedTaskId: linked ? "TASK-1" : undefined,
        },
      ],
      nextCursor: undefined,
      searchSupported: true,
      incompleteResults: false,
    }));
    host.issueItemsList = list;
    const queryClient = createQueryClient();
    const dialog = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <SettingsModalProvider>
          <IssueImportDialog
            open={open}
            onOpenChange={() => {}}
            repoPath="/repo"
            provider={azureProvider}
            onImported={() => {}}
          />
        </SettingsModalProvider>
      </QueryClientProvider>
    );
    const view = render(dialog(true));
    await screen.findByTitle("Linked to Task TASK-1");
    view.rerender(dialog(false));

    linked = false;
    await invalidateRepoIssueItemsQueries(queryClient, "/repo");
    view.rerender(dialog(true));

    const checkbox = await screen.findByRole("checkbox", { name: "Select Issue 1" });
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByTitle("Linked to Task TASK-1")).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
