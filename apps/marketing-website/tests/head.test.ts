import { describe, expect, test } from "bun:test";
import { headTags, type PageHead } from "../src/layouts/head";

const home: PageHead = { title: "OpenDucktor", description: "Mission control", indexable: true };
const missing: PageHead = { ...home, title: "Page not found | OpenDucktor", indexable: false };
const site = new URL("https://openducktor.dev");

describe("headTags", () => {
  test("lists the production home page with its canonical and sharing URLs", () => {
    expect(headTags(home, "/", "production", site)).toEqual({
      title: "OpenDucktor",
      description: "Mission control",
      robots: undefined,
      canonical: "https://openducktor.dev/",
      image: "https://openducktor.dev/open-graph.png",
    });
  });

  test("keeps previews and local builds out of search results", () => {
    expect(headTags(home, "/", "preview", site)).toMatchObject({
      robots: "noindex, nofollow",
      canonical: "https://openducktor.dev/",
    });
    expect(headTags(home, "/", "local", undefined)).toMatchObject({
      robots: "noindex, nofollow",
      canonical: undefined,
      image: undefined,
    });
  });

  test("never lists the 404 page, and gives it no canonical URL", () => {
    expect(headTags(missing, "/404", "production", site)).toMatchObject({
      robots: "noindex, nofollow",
      canonical: undefined,
    });
  });
});
