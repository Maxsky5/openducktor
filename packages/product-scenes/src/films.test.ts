import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Each film renders its static view, builds the master timeline from that markup, and plays to its
// end: each scene of its sets, each move of the camera, each caption, and the titles. A caption
// that shows while another one shows, a set without a scene, a missing mark, or a missing part
// that the camera frames fails the test. The document has no layout, so the boxes of the camera
// have no size. A browser checks the motion with the video tool.

GlobalRegistrator.register();
// The test loads no stylesheet, so it gives each element the design pixel that a build reads.
const designPixel = document.createElement("style");
designPixel.textContent = "* { --u: 1px; }";
document.head.append(designPixel);
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});
const [{ createElement }, { renderToStaticMarkup }, { mountFilm }, { FILM_NAMES }, views, keys] =
  await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("./films/engine/film"),
    import("./films/registry"),
    import("./films/views"),
    import("./replicas/keys"),
  ]);

/** The most words of a caption sub. */
const SUB_WORDS_MAX = 12;

/** The most characters of a caption title line, so the line fits the caption column. */
const TITLE_LINE_MAX = 19;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test.each([...FILM_NAMES])("the %s film plays from its view to its end", async (name) => {
  const View = await views.FILM_VIEWS[name]();
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(View, { keys: keys.MAC_KEYS }));
  document.body.append(holder);
  try {
    const root = holder.querySelector("[data-film]");
    if (!(root instanceof HTMLElement)) throw new Error(`The ${name} film has no root.`);
    const film = await mountFilm(root, name);
    film.seek(film.duration);
  } finally {
    holder.remove();
  }
});

test("the release film rejects the keys of Windows and Linux, because its captions show macOS keys", async () => {
  const View = await views.FILM_VIEWS["release-1-2-2"]();
  expect(() => renderToStaticMarkup(createElement(View, { keys: keys.PC_KEYS }))).toThrow(
    "--keys mac",
  );
});

test("each caption title line of the release film fits the caption column", async () => {
  const { CAPTIONS } = await import("./films/release-1-2-2/captions");
  const long = Object.values(CAPTIONS)
    .flatMap((caption) => caption.title.map((line) => line.replaceAll("*", "")))
    .filter((line) => line.length > TITLE_LINE_MAX);
  expect(long).toEqual([]);
});

test("each caption sub of the release film has 12 words or fewer, so a viewer reads it in time", async () => {
  const { CAPTIONS } = await import("./films/release-1-2-2/captions");
  const long = Object.values(CAPTIONS)
    .map((caption) => caption.sub)
    .filter((sub) => sub.split(" ").length > SUB_WORDS_MAX);
  expect(long).toEqual([]);
});
