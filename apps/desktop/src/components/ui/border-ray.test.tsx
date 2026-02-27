import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorderRay } from "@/components/ui/border-ray";
import {
  BORDER_RAY_DEFAULT_LENGTH,
  BORDER_RAY_DEFAULT_PERIMETER,
  BORDER_RAY_DEFAULT_TURN_DURATION_MS,
} from "@/components/ui/border-ray-model";

describe("BorderRay", () => {
  test("renders with default fallback CSS variables", () => {
    const html = renderToStaticMarkup(createElement(BorderRay));

    expect(html).toContain(
      `--odt-border-ray-turn-duration:${BORDER_RAY_DEFAULT_TURN_DURATION_MS}ms`,
    );
    expect(html).toContain(`--odt-border-ray-perimeter:${BORDER_RAY_DEFAULT_PERIMETER}`);
    expect(html).toContain(`--odt-border-ray-length:${BORDER_RAY_DEFAULT_LENGTH}`);
    expect(html).not.toContain("--kanban-ray-");
  });

  test("accepts custom turn duration", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { turnDurationMs: 4200 }));

    expect(html).toContain("--odt-border-ray-turn-duration:4200ms");
  });

  test("renders expected ray layers and merges className", () => {
    const html = renderToStaticMarkup(createElement(BorderRay, { className: "custom-ray" }));

    expect(html).toContain('class="odt-border-ray custom-ray"');
    expect(html).toContain('class="odt-border-ray-segment-halo"');
    expect(html).toContain('class="odt-border-ray-segment-glow"');
    expect(html).toContain('class="odt-border-ray-segment"');
  });
});
