import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import openducktorMarkUrl from "@/assets/openducktor-mark.svg";
import { OpenDucktorMark } from "./openducktor-mark";

describe("OpenDucktorMark", () => {
  test("renders the mark tile as a decorative image", () => {
    const html = renderToStaticMarkup(<OpenDucktorMark className="size-10" />);

    expect(html).toContain(
      `<img src="${openducktorMarkUrl}" alt="" class="block shrink-0 size-10"/>`,
    );
  });
});
