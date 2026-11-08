import { describe, expect, test } from "bun:test";
import { buildAnnotation } from "@/features/browser-annotations/browser-annotation-test-support";
import { commentBoxPosition } from "./browser-comment-box-position";
import { browserAnnotationAnchors } from "./use-browser-anchors";

describe("browserAnnotationAnchors", () => {
  test("follows only the annotations of the current page, also after an in-page link", () => {
    const here = buildAnnotation({
      id: "here",
      page: { url: "http://localhost:3000/app#top", title: "App" },
    });
    const other = buildAnnotation({
      id: "other",
      page: { url: "http://localhost:3000/settings", title: "Settings" },
    });

    expect(browserAnnotationAnchors([here, other], "http://localhost:3000/app#bottom")).toEqual([
      { annotationId: "here", number: 1, selectors: here.elements.map((item) => item.selector) },
    ]);
  });

  test("keeps the annotation number that the sidebar shows", () => {
    const other = buildAnnotation({
      id: "other",
      number: 1,
      page: { url: "http://localhost:3000/settings", title: "Settings" },
    });
    const here = buildAnnotation({
      id: "here",
      number: 2,
      page: { url: "http://localhost:3000/app", title: "App" },
    });

    expect(browserAnnotationAnchors([other, here], "http://localhost:3000/app")).toEqual([
      { annotationId: "here", number: 2, selectors: here.elements.map((item) => item.selector) },
    ]);
  });
});

describe("commentBoxPosition", () => {
  test("places the box under the selection, or above it when the page area has no room", () => {
    const bounds = { width: 800, height: 600 };

    expect(commentBoxPosition({ x: 100, y: 50, width: 40, height: 20 }, bounds)).toEqual({
      left: 100,
      top: 78,
    });
    expect(commentBoxPosition({ x: 700, y: 500, width: 40, height: 20 }, bounds)).toEqual({
      left: 472,
      top: 252,
    });
  });
});
