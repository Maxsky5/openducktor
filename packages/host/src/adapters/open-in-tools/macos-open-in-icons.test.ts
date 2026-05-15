import { describe, expect, test } from "bun:test";
import { iconsetRepresentationScore } from "./macos-open-in-icons";

describe("macOS Open In icon extraction", () => {
  test("scores only iconset representations up to the Open In icon size cap", () => {
    expect(iconsetRepresentationScore("icon_16x16.png")).toBe(256);
    expect(iconsetRepresentationScore("icon_16x16@2x.png")).toBe(1024);
    expect(iconsetRepresentationScore("icon_128x128@2x.png")).toBe(65_536);
    expect(iconsetRepresentationScore("icon_256x256.png")).toBe(65_536);
    expect(iconsetRepresentationScore("icon_256x256@2x.png")).toBeNull();
    expect(iconsetRepresentationScore("icon_512x512@2x.png")).toBeNull();
    expect(iconsetRepresentationScore("icon_16x16foo.png")).toBeNull();
    expect(iconsetRepresentationScore("icon_16x16@2foo.png")).toBeNull();
    expect(iconsetRepresentationScore("not-an-icon.png")).toBeNull();
  });
});
