import { describe, expect, test } from "bun:test";
import { GraphemeSegmenter, segmentGraphemes } from "./grapheme-segmenter";

const graphemes = (text: string) => segmentGraphemes(text).map(({ segment }) => segment);

describe("grapheme segmenter", () => {
  test("keeps decomposed accents and astral letters whole", () => {
    expect(graphemes("Équipe")).toEqual(["É", "q", "u", "i", "p", "e"]);
    expect(graphemes("𝒜b")).toEqual(["𝒜", "b"]);
  });

  test("keeps emoji sequences whole", () => {
    expect(graphemes("👍🏽!")).toEqual(["👍🏽", "!"]);
    expect(graphemes("👩‍💻a")).toEqual(["👩‍💻", "a"]);
    expect(graphemes("🇫🇷🇩🇪")).toEqual(["🇫🇷", "🇩🇪"]);
    expect(graphemes("1️⃣")).toEqual(["1️⃣"]);
    expect(graphemes("a\r\nb")).toEqual(["a", "\r\n", "b"]);
  });

  test("matches the platform segmenter on the initials that shared code builds", () => {
    const platform = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const text of ["Équipe Mobile", "Équipe", "👩‍💻 Studio", "🇫🇷 Paris", "日本語"]) {
      expect(graphemes(text)).toEqual([...platform.segment(text)].map(({ segment }) => segment));
    }
  });

  test("refuses word and sentence segmentation", () => {
    expect(() => new GraphemeSegmenter(undefined, { granularity: "word" })).toThrow(
      "This device supports only grapheme segmentation, not word.",
    );
    expect([...new GraphemeSegmenter().segment("ab")].map(({ index }) => index)).toEqual([0, 1]);
  });
});
