import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MatchedText } from "./command-palette-match";

describe("MatchedText", () => {
  test("keeps the full text and marks only the matched parts", () => {
    const { container } = render(<MatchedText text="Add Facebook login" query="FACE login" />);

    expect(container.textContent).toBe("Add Facebook login");
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
      "Face",
      "login",
    ]);
  });
});
