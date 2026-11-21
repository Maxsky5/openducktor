import { describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { preloadTourScenes } from "@openducktor/product-scenes/react/tour";
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

const renderAsync = (element: ReactElement): Promise<RenderResult> =>
  act(async () => render(element));

const renderScene = (scene: ReactElement): Promise<RenderResult> =>
  renderAsync(withProviders(scene));

const sceneRoot = (view: RenderResult, name: string): HTMLElement => {
  const root = view.container.querySelector<HTMLElement>(`[data-scene="${name}"]`);
  if (!root) throw new Error(`The ${name} scene did not render.`);
  return root;
};

await preloadTourScenes();

describe("TourScene", () => {
  test("fills the tour frame in the theme of the app, and follows a theme change", async () => {
    const view = await renderScene(<TourScene scene="hero" platform="darwin" />);
    try {
      const root = sceneRoot(view, "hero");
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
      const root = sceneRoot(view, "palette");
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
      const modifiers = (view: RenderResult) => {
        const scene = within(sceneRoot(view, "palette"));
        return { mac: scene.queryAllByText("⌘").length, pc: scene.queryAllByText("Ctrl").length };
      };
      const macKeys = modifiers(mac);
      const pcKeys = modifiers(other);
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
