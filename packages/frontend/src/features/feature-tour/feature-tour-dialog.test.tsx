import { describe, expect, mock, test } from "bun:test";
import { ActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { TEST_ACTIVE_WORKSPACE } from "@openducktor/frontend-core/test-support/active-workspace-wrapper";
import {
  type TaskWorkflowActions,
  TaskWorkflowActionsContext,
} from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import type { ActiveWorkspace } from "@openducktor/frontend-core/types/session-slices";
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import * as diffViewerModule from "@/components/features/agents/pierre-file-pair-diff-viewer";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/test-utils/query-provider";
import { restoreAfterTestBody } from "@/test-utils/restore-after-test-body";
import { ChecksStateContext } from "@/state/app-state-contexts";
import {
  createChecksStateFixture,
  createTaskWorkflowActionsFixture,
} from "@/test-utils/shared-test-fixtures";
import { FeatureTourProvider, useFeatureTour } from "./feature-tour-context";
import { FeatureTourDialogHost } from "./feature-tour-dialog-host";

function Opener(): ReactElement {
  const { openFeatureTour } = useFeatureTour();
  return (
    <button type="button" onClick={(event) => openFeatureTour(event.currentTarget)}>
      Open tour
    </button>
  );
}

// Without the worker pool of the app, the first diff loads the syntax highlighter on the test
// thread. The tests check the tour controls, not the diffs of the pictures.
const DIFF_VIEWER_MODULE = "@/components/features/agents/pierre-file-pair-diff-viewer";
const realDiffViewerModule = { ...diffViewerModule };

/** The queries of the open tour dialog. */
type TourQueries = ReturnType<typeof within>;

const renderTour = ({
  activeWorkspace = TEST_ACTIVE_WORKSPACE,
  actions = {},
}: {
  activeWorkspace?: ActiveWorkspace | null;
  actions?: Partial<TaskWorkflowActions>;
} = {}): RenderResult => {
  // The stub lives until the test unmounts the tour, so other test files get the real viewer.
  mock.module(DIFF_VIEWER_MODULE, () => ({
    ...realDiffViewerModule,
    PierreFilePairDiffViewer: () => <div data-testid="tour-diff" />,
  }));
  const restoreDiffViewer = restoreAfterTestBody(() => {
    mock.module(DIFF_VIEWER_MODULE, () => realDiffViewerModule);
  });
  const view = render(
    <QueryProvider>
      <ThemeProvider>
        <ActiveWorkspaceContext.Provider value={{ activeWorkspace, setActiveWorkspace: () => {} }}>
          <ChecksStateContext.Provider value={createChecksStateFixture()}>
            <TaskWorkflowActionsContext.Provider value={createTaskWorkflowActionsFixture(actions)}>
              <FeatureTourProvider>
                <Opener />
                <FeatureTourDialogHost />
              </FeatureTourProvider>
            </TaskWorkflowActionsContext.Provider>
          </ChecksStateContext.Provider>
        </ActiveWorkspaceContext.Provider>
      </ThemeProvider>
    </QueryProvider>,
  );
  return {
    ...view,
    unmount: () => {
      try {
        view.unmount();
      } finally {
        restoreDiffViewer();
      }
    },
  };
};

const openTour = async (): Promise<TourQueries> => {
  const opener = screen.getByRole("button", { name: "Open tour" });
  opener.focus();
  await act(async () => {
    fireEvent.click(opener);
  });
  return within(await screen.findByRole("dialog"));
};

// The stepper jumps to a slide, so a test renders only the slides it checks.
const openStep = async (tour: TourQueries, name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(tour.getByRole("button", { name }));
  });
};

const openLastSlide = async (): Promise<TourQueries> => {
  const tour = await openTour();
  await openStep(tour, "Slide 8: You stay in control");
  return tour;
};

/** The picture of the current slide. The pictures of seen slides stay mounted, but hidden. */
const visiblePicture = (): HTMLElement => {
  const pictures = Array.from(document.querySelectorAll<HTMLElement>(".t-tour-picture")).filter(
    (picture) => picture.style.display !== "none",
  );
  const [picture] = pictures;
  if (!picture || pictures.length !== 1) throw new Error("The tour shows no single picture.");
  return picture;
};

const waitForClosedTour = (): Promise<void> =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 500 });

const clickNext = async (tour: TourQueries, times: number): Promise<void> => {
  for (let step = 0; step < times; step += 1) {
    await act(async () => {
      fireEvent.click(tour.getByRole("button", { name: "Next" }));
    });
  }
};

// The host loads the dialog and its scenes lazily. Load them here, so no test pays for the first
// load.
await (await import("./feature-tour-dialog-loader")).loadFeatureTourDialog();

describe("FeatureTourDialog", () => {
  test("moves with Next and Back, and Back gives its focus to Next on the first slide", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      expect(tour.getByText("1 of 8")).toBeDefined();
      expect(tour.getByRole("heading", { name: "Welcome to OpenDucktor" })).toBeDefined();
      expect(tour.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);

      await clickNext(tour, 1);
      expect(tour.getByText("2 of 8")).toBeDefined();
      expect(tour.getByRole("heading", { name: "Workspaces hold your work" })).toBeDefined();
      const back = tour.getByRole("button", { name: "Back" });
      back.focus();
      await act(async () => {
        fireEvent.click(back);
      });
      expect(tour.getByText("1 of 8")).toBeDefined();
      // Back is disabled on slide 1, so its focus moves to Next.
      expect(document.activeElement).toBe(tour.getByRole("button", { name: "Next" }));
    } finally {
      view.unmount();
    }
  });

  test("Next on the last slide gives the focus to Done, and Done returns it to the opener", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      await openStep(tour, "Slide 7: Control it from your phone");
      await clickNext(tour, 1);
      expect(tour.getByText("8 of 8")).toBeDefined();
      expect(tour.getByRole("heading", { name: "You stay in control" })).toBeDefined();
      expect(tour.queryByRole("button", { name: "Next" })).toBeNull();
      const done = tour.getByRole("button", { name: "Done" });
      expect(document.activeElement).toBe(done);

      await act(async () => {
        fireEvent.click(done);
      });
      await waitForClosedTour();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open tour" }));
    } finally {
      view.unmount();
    }
  });

  test("the arrow keys move between slides and stop at both ends", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      const dialog = screen.getByRole("dialog");
      const press = async (key: string): Promise<void> => {
        await act(async () => {
          fireEvent.keyDown(document.activeElement ?? dialog, { key });
        });
      };
      await press("ArrowLeft");
      expect(tour.getByText("1 of 8")).toBeDefined();
      await press("ArrowRight");
      await press("ArrowRight");
      expect(tour.getByText("3 of 8")).toBeDefined();
      await press("ArrowLeft");
      expect(tour.getByText("2 of 8")).toBeDefined();
      await openStep(tour, "Slide 7: Control it from your phone");
      await press("ArrowRight");
      expect(tour.getByText("8 of 8")).toBeDefined();
      await press("ArrowRight");
      expect(tour.getByText("8 of 8")).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("each step of the stepper opens its slide", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      const step = (name: string) => tour.getByRole("button", { name });
      expect(step("Slide 1: Welcome to OpenDucktor").getAttribute("aria-current")).toBe("step");
      await act(async () => {
        fireEvent.click(step("Slide 5: Two kinds of agent sessions"));
      });
      expect(tour.getByText("5 of 8")).toBeDefined();
      expect(step("Slide 5: Two kinds of agent sessions").getAttribute("aria-current")).toBe(
        "step",
      );
      await act(async () => {
        fireEvent.click(step("Slide 8: You stay in control"));
      });
      expect(tour.getByRole("button", { name: "Create task" })).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test.each([
    "Slide 2: Workspaces hold your work",
    "Slide 3: Features, bugs, and tasks",
    "Slide 4: You decide when the next role starts",
    "Slide 7: Control it from your phone",
    "Slide 8: You stay in control",
  ])(
    "each pin of the picture on %s has the number of its line in the list of parts",
    async (name) => {
      const view = renderTour();
      try {
        const tour = await openTour();
        await openStep(tour, name);
        const picture = visiblePicture();
        const numbers = (selector: string): (string | null)[] =>
          Array.from(picture.querySelectorAll(selector), (element) => element.textContent);
        const parts = numbers("[data-tour-parts] > li > span:first-child");
        expect(numbers("[data-tour-pin]")).toEqual(parts);
        expect(parts.length).toBeGreaterThan(0);
      } finally {
        view.unmount();
      }
    },
  );

  test("screen readers get the parts of the hidden picture", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      const partTitles = (): string[] =>
        within(tour.getByRole("list", { name: "Parts of the picture" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent?.split(":")[0] ?? "");
      await openStep(tour, "Slide 2: Workspaces hold your work");
      expect(partTitles()).toContain("Workspace rail");
      expect(tour.getByText(/^Workspace rail: One tile for each repository/)).toBeDefined();
      await clickNext(tour, 1);
      expect(partTitles()).toEqual(["Feature", "Bug", "Task"]);
      // The list sits beside the slide text, which shows only the current slide.
      const descriptionId = screen.getByRole("dialog").getAttribute("aria-describedby");
      const descriptions = document.querySelectorAll(`[id="${descriptionId}"]`);
      expect(Array.from(descriptions, (element) => element.textContent?.slice(0, 13))).toEqual([
        "Choose a type",
      ]);
    } finally {
      view.unmount();
    }
  });

  test("keeps a seen live scene loaded while another slide shows", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      const scene = await waitFor(() => {
        const element = document.querySelector('.t-tour-picture [data-scene="hero"]');
        if (!element) throw new Error("The hero scene has not loaded yet.");
        return element;
      });
      await openStep(tour, "Slide 5: Two kinds of agent sessions");
      expect(document.querySelector('.t-tour-picture [data-scene="hero"]')).toBe(scene);
      await openStep(tour, "Slide 1: Welcome to OpenDucktor");
      expect(visiblePicture().querySelector('[data-scene="hero"]')).toBe(scene);
    } finally {
      view.unmount();
    }
  });

  test("starts each opening at slide 1", async () => {
    const view = renderTour();
    try {
      const tour = await openTour();
      await clickNext(tour, 3);
      expect(tour.getByText("4 of 8")).toBeDefined();
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
      await waitForClosedTour();

      const reopened = await openTour();
      expect(reopened.getByText("1 of 8")).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("stays open on an outside click", async () => {
    const view = renderTour();
    try {
      await openTour();
      const backdrop = document.querySelector<HTMLElement>("[data-slot=dialog-positioner]");
      if (!backdrop) throw new Error("The tour has no dialog positioner.");
      await act(async () => {
        // Radix listens for outside pointer events from the next task after the dialog opens.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Radix handles an outside left click when its click follows the pointer down.
        fireEvent.pointerDown(backdrop, { button: 0 });
        fireEvent.click(backdrop, { button: 0 });
      });
      expect(screen.getByRole("dialog").getAttribute("data-state")).toBe("open");
    } finally {
      view.unmount();
    }
  });

  test("Tab wraps between the tour controls and skips the sample buttons in the picture", async () => {
    const view = renderTour();
    try {
      const tour = await openLastSlide();
      const back = tour.getByRole("button", { name: "Back" });
      const close = tour.getByRole("button", { name: "Close" });
      close.focus();
      await act(async () => {
        fireEvent.keyDown(close, { key: "Tab" });
      });
      expect(document.activeElement).toBe(back);
      await act(async () => {
        fireEvent.keyDown(back, { key: "Tab", shiftKey: true });
      });
      expect(document.activeElement).toBe(close);
    } finally {
      view.unmount();
    }
  });

  test("Create task closes the tour and opens the New task form from the tour opener", async () => {
    // The New task form records the focused element and gives the focus back to it on close.
    const onCreateTask = mock(() => document.activeElement);
    const view = renderTour({ actions: { onCreateTask } });
    try {
      const tour = await openLastSlide();
      await act(async () => {
        fireEvent.click(tour.getByRole("button", { name: "Create task" }));
      });
      expect(onCreateTask).toHaveBeenCalledTimes(1);
      expect(onCreateTask).toHaveBeenCalledWith();
      expect(onCreateTask.mock.results[0]?.value).toBe(
        screen.getByRole("button", { name: "Open tour" }),
      );
      await waitForClosedTour();
    } finally {
      view.unmount();
    }
  });

  test("disables Create task like New task without an active workspace", async () => {
    const view = renderTour({ activeWorkspace: null });
    try {
      const tour = await openLastSlide();
      expect(tour.getByRole("button", { name: "Create task" }).hasAttribute("disabled")).toBe(true);
      expect(tour.getByRole("button", { name: "Done" }).hasAttribute("disabled")).toBe(false);
    } finally {
      view.unmount();
    }
  });
});
