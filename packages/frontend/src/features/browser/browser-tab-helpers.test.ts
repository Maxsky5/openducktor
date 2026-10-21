import { describe, expect, test } from "bun:test";
import { buildAnnotation } from "@/features/browser-annotations/browser-annotation-test-support";
import { commentBoxPosition } from "./browser-comment-box-position";
import { browserAnnotationAnchors } from "./use-browser-anchors";
import { nextBrowserPickerSelection } from "./use-browser-picker";

const element = (nodeRef: string) => ({
  nodeRef,
  label: nodeRef,
  box: { x: 0, y: 0, width: 10, height: 10 },
});

describe("nextBrowserPickerSelection", () => {
  test("a click selects one element and Shift-click adds or removes one", () => {
    const one = nextBrowserPickerSelection([element("a")], element("b"), false);
    const two = nextBrowserPickerSelection(one, element("c"), true);
    const back = nextBrowserPickerSelection(two, element("b"), true);

    expect(one.map((item) => item.nodeRef)).toEqual(["b"]);
    expect(two.map((item) => item.nodeRef)).toEqual(["b", "c"]);
    expect(back.map((item) => item.nodeRef)).toEqual(["c"]);
  });
});

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
      { annotationId: "here", selectors: here.elements.map((item) => item.selector) },
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
