import { describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { BorderRay } from "@/components/ui/border-ray";
import {
  BORDER_RAY_DEFAULT_LENGTH,
  BORDER_RAY_DEFAULT_PERIMETER,
  BORDER_RAY_DEFAULT_STROKE_WIDTH,
  BORDER_RAY_DEFAULT_TURN_DURATION_MS,
} from "@/components/ui/border-ray-model";

describe("BorderRay", () => {
  test("renders with default fallback CSS variables", () => {
    const html = renderToStaticMarkup(createElement(BorderRay));

    expect(html).toContain(
      `--odt-border-ray-turn-duration:${BORDER_RAY_DEFAULT_TURN_DURATION_MS}ms`,
    );
    expect(html).toContain(`--odt-border-ray-perimeter:${BORDER_RAY_DEFAULT_PERIMETER}px`);
    expect(html).toContain(`--odt-border-ray-length:${BORDER_RAY_DEFAULT_LENGTH}px`);
    expect(html).toContain(`--odt-border-ray-stroke-width:${BORDER_RAY_DEFAULT_STROKE_WIDTH}`);
    expect(html).not.toContain("--kanban-ray-");
  });

  test("accepts custom turn duration", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { turnDurationMs: 4200 }));

    expect(html).toContain("--odt-border-ray-turn-duration:4200ms");
  });

  test("accepts a custom ray color", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { color: "#d97706" }));

    expect(html).toContain("--odt-border-ray-color:#d97706");
  });

  test("accepts a custom stroke width", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { strokeWidth: 2.6 }));

    expect(html).toContain("--odt-border-ray-stroke-width:2.6");
  });

  test("renders expected ray markup and merges className", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { className: "custom-ray" }));

    expect(html).toContain('class="odt-border-ray custom-ray"');
    expect(html).toContain('class="odt-border-ray-segment"');
  });
});

describe("BorderRay size", () => {
  test("measures the layout size of its host, not the size after a scale transform", () => {
    const host = document.createElement("div");
    // A scaled ancestor halves the box that getBoundingClientRect returns.
    Object.defineProperty(host, "offsetWidth", { value: 200 });
    Object.defineProperty(host, "offsetHeight", { value: 100 });
    host.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50);
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(BorderRay)));

    expect(host.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 200 100");

    act(() => root.unmount());
    host.remove();
  });
});
