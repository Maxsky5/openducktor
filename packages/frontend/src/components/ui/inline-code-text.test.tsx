import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { InlineCodeText } from "./inline-code-text";

afterEach(cleanup);

describe("InlineCodeText", () => {
  test("shows each command between backticks as code", () => {
    const { container } = render(
      <p>
        <InlineCodeText text="Run `claude update`, or run `opencode upgrade`." />
      </p>,
    );

    expect(container.textContent).toBe("Run claude update, or run opencode upgrade.");
    expect([...container.querySelectorAll("code")].map((code) => code.textContent)).toEqual([
      "claude update",
      "opencode upgrade",
    ]);
  });

  test("keeps an unpaired backtick as text", () => {
    const { container } = render(
      <p>
        <InlineCodeText text="Codex reported: missing ` quote" />
      </p>,
    );

    expect(container.textContent).toBe("Codex reported: missing ` quote");
    expect(container.querySelector("code")).toBeNull();
  });
});
