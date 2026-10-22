import { describe, expect, test } from "bun:test";
import { buildAnnotation } from "./browser-annotation-test-support";
import { buildBrowserAnnotationSendGroup } from "./use-browser-annotation-composer";

describe("buildBrowserAnnotationSendGroup", () => {
  test("counts pending annotations and lists the screenshots that they send", () => {
    const group = buildBrowserAnnotationSendGroup([
      buildAnnotation({ id: "a", number: 1 }),
      buildAnnotation({ id: "b", number: 2, includeScreenshot: false }),
      buildAnnotation({ id: "c", number: 3, status: "submitting" }),
    ]);

    expect(group).toEqual({
      key: "browser_annotations",
      count: 2,
      accessibleLabel: "2 pending browser annotations",
      attachments: {
        items: [{ kind: "image", mime: "image/png", name: "annotation-1.png" }],
        removalHint: "Edit the annotations, and turn off Screenshot.",
      },
    });
    expect(buildBrowserAnnotationSendGroup([buildAnnotation({ status: "submitting" })])).toBe(null);
  });
});
