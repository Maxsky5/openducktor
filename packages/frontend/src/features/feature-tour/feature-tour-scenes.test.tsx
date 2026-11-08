import { beforeAll, describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, fireEvent, type RenderResult, render, waitFor, within } from "@testing-library/react";
import { Activity, type ReactElement } from "react";
import { ThemeProvider, useTheme } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/test-utils/query-provider";
import { TourScene } from "./feature-tour-scenes";

function DarkThemeButton(): ReactElement {
  const { setThemePreference } = useTheme();
  return (
    <button type="button" onClick={() => setThemePreference("dark")}>
      Dark
    </button>
  );
}

const connection = createTestClientConnection({ client: { setTheme: async () => {} } });

const withProviders = (scene: ReactElement): ReactElement => (
  <QueryProvider connection={connection}>
    <ThemeProvider>
      {scene}
      <DarkThemeButton />
    </ThemeProvider>
  </QueryProvider>
);

// A scene suspends while its view and its timeline load, so each render waits in `act`.
const renderAsync = async (element: ReactElement): Promise<RenderResult> => {
  let view: RenderResult | undefined;
  await act(async () => {
    view = render(element);
  });
  if (!view) throw new Error("The scene did not render.");
  return view;
};

const renderScene = (scene: ReactElement): Promise<RenderResult> =>
  renderAsync(withProviders(scene));

const sceneRoot = (view: RenderResult, name: string): HTMLElement => {
  const root = view.container.querySelector<HTMLElement>(`[data-scene="${name}"]`);
  if (!root) throw new Error(`The ${name} scene did not render.`);
  return root;
};

/** A scene suspends while its view and its timeline load, so a test waits for its root. */
const findSceneRoot = (view: RenderResult, name: string): Promise<HTMLElement> =>
  waitFor(() => sceneRoot(view, name));

// The first load of the scene modules can exceed the test budget, so both scenes load once here.
beforeAll(async () => {
  for (const name of ["hero", "palette"] as const) {
    (await renderScene(<TourScene scene={name} platform="darwin" />)).unmount();
  }
}, 10_000);

describe("TourScene", () => {
  test("fills the tour frame in the theme of the app, and follows a theme change", async () => {
    const view = await renderScene(<TourScene scene="hero" platform="darwin" />);
    try {
      const root = await findSceneRoot(view, "hero");
      expect(root.dataset.theme).toBe("light");
      // The tour frame draws the window, so the scene is framed: it shows no window border and no
      // pointer.
      expect(root.hasAttribute("data-framed")).toBe(true);
      expect(view.getByRole("img", { name: /^The OpenDucktor Kanban board/ })).toBeDefined();

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Dark" }));
      });
      await waitFor(() => expect(sceneRoot(view, "hero").dataset.theme).toBe("dark"));
    } finally {
      view.unmount();
    }
  });

  test("a scene stops while its slide hides and plays again when the slide shows", async () => {
    const slide = (mode: "visible" | "hidden"): ReactElement =>
      withProviders(
        <Activity mode={mode}>
          <TourScene scene="palette" platform="darwin" />
        </Activity>,
      );
    const view = await renderAsync(slide("visible"));
    try {
      const root = await findSceneRoot(view, "palette");
      await waitFor(() => expect(root.dataset.motion).toBe("running"));

      view.rerender(slide("hidden"));
      // The hidden slide runs the cleanup of the scene, which stops its timeline.
      expect(root.dataset.motion).toBeUndefined();

      view.rerender(slide("visible"));
      expect(root.dataset.motion).toBe("running");
    } finally {
      view.unmount();
    }
  });

  test("a scene shows the modifier keys of the device", async () => {
    const mac = await renderScene(<TourScene scene="palette" platform="darwin" />);
    const other = await renderScene(<TourScene scene="palette" platform="linux" />);
    try {
      /** The number of keys with each modifier label in the scene. */
      const modifiers = async (view: RenderResult): Promise<{ mac: number; pc: number }> => {
        const scene = within(await findSceneRoot(view, "palette"));
        return { mac: scene.queryAllByText("⌘").length, pc: scene.queryAllByText("Ctrl").length };
      };
      const macKeys = await modifiers(mac);
      const pcKeys = await modifiers(other);
      expect(macKeys.mac).toBeGreaterThan(0);
      expect(macKeys.pc).toBe(0);
      expect(pcKeys.mac).toBe(0);
      expect(pcKeys.pc).toBeGreaterThan(0);
    } finally {
      mac.unmount();
      other.unmount();
    }
  });
});
