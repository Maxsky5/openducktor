import { afterEach, describe, expect, test } from "bun:test";
import { Activity, act, createElement, type ReactElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { BorderRay } from "@/components/ui/border-ray";

type Mounted = { host: HTMLDivElement; root: Root };

const mounted: Mounted[] = [];
const originalMatchMedia = window.matchMedia;

const mount = (element: ReactElement = <BorderRay />): Mounted => {
  const host = document.createElement("div");
  // A scaled ancestor halves the box that getBoundingClientRect returns.
  Object.defineProperty(host, "offsetWidth", { value: 200 });
  Object.defineProperty(host, "offsetHeight", { value: 100 });
  host.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50);
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  const entry = { host, root };
  mounted.push(entry);
  return entry;
};

const bars = (host: HTMLElement): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>(".odt-border-ray-bar"));

const animations = (host: HTMLElement): Animation[] =>
  bars(host).flatMap((bar) => bar.getAnimations());

const expectPausedAtTurnStart = (host: HTMLElement): void => {
  for (const animation of animations(host)) {
    expect(animation.playState).toBe("paused");
    expect(animation.currentTime).toBe(0);
  }
};

const expectRunning = (host: HTMLElement): void => {
  for (const animation of animations(host)) expect(animation.playState).toBe("running");
};

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  window.matchMedia = originalMatchMedia;
});

describe("BorderRay", () => {
  test("renders one bar in each edge band and merges className", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { className: "custom-ray" }));

    expect(html).toContain('class="odt-border-ray custom-ray"');
    expect(html.split('class="odt-border-ray-segment"')).toHaveLength(5);
    expect(html.split('class="odt-border-ray-bar"')).toHaveLength(5);
  });

  test("accepts a custom ray color", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { color: "#d97706" }));

    expect(html).toContain("--odt-border-ray-color:#d97706");
  });

  test("sizes the layer from the layout size of its host, not the size after a scale", () => {
    const { host } = mount(<BorderRay strokeWidth={2.6} />);
    const layer = host.querySelector<HTMLElement>(".odt-border-ray");

    expect(layer?.style.width).toBe("206px");
    expect(layer?.style.height).toBe("106px");
  });

  test("runs every bar on one shared turn", () => {
    const { host } = mount(<BorderRay turnDurationMs={2000} />);
    const turn = animations(host);

    expect(turn).toHaveLength(4);
    const startTime = turn[0]?.startTime;
    for (const animation of turn) {
      expect(animation.effect?.getTiming().duration).toBe(2000);
      expect(animation.startTime).toBe(startTime ?? null);
    }
  });

  test("pauses the ray while its view is hidden and keeps one animation on each bar", () => {
    const inView = (mode: "visible" | "hidden") => (
      <StrictMode>
        <Activity mode={mode}>
          <BorderRay />
        </Activity>
      </StrictMode>
    );
    const { host, root } = mount(inView("visible"));
    expectRunning(host);

    act(() => root.render(inView("hidden")));
    expectPausedAtTurnStart(host);

    act(() => root.render(inView("visible")));
    for (const bar of bars(host)) expect(bar.getAnimations()).toHaveLength(1);
    expectRunning(host);
  });

  test("holds the ray still while the system asks for reduced motion", () => {
    let matches = true;
    let notify: () => void = () => {};
    window.matchMedia = (query: string): MediaQueryList => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        notify = () => {
          const event = new Event("change");
          if ("handleEvent" in listener) listener.handleEvent(event);
          else listener(event);
        };
      },
      removeEventListener: () => {},
      dispatchEvent: () => true,
    });
    const { host } = mount();
    expectPausedAtTurnStart(host);

    matches = false;
    act(() => notify());
    expectRunning(host);

    matches = true;
    act(() => notify());
    expectPausedAtTurnStart(host);
  });

  test("keeps the place of each bar in the turn when the geometry changes", () => {
    const { host, root } = mount(<BorderRay strokeWidth={2.6} />);
    const before = animations(host);
    const startTime = before[0]?.startTime;

    act(() => root.render(<BorderRay strokeWidth={8} />));
    const after = animations(host);

    expect(after).toEqual(before);
    expect(after[0]?.startTime).toBe(startTime ?? null);
    const effect = after[0]?.effect;
    if (!(effect instanceof KeyframeEffect)) throw new Error("Expected a keyframe effect.");
    const keyframes = effect.getKeyframes();
    // The thicker stroke widens the layer margin, so the top bar starts further from its corner.
    expect(keyframes[0]?.transform).toBe("translate(5.5px, 0px)");
  });
});
