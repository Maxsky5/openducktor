import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRuntimeIcon } from "./agent-runtime-icon";

describe("AgentRuntimeIcon", () => {
  test("renders the OpenCode brand icon", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRuntimeIcon, {
        runtimeKind: "opencode",
        className: "size-5",
      }),
    );

    expect(html).toContain('viewBox="0 0 512 512"');
    expect(html).toContain("dark:fill-[#F1ECEC]");
    expect(html).toContain("size-5");
  });

  test("renders the Codex brand icon", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRuntimeIcon, {
        runtimeKind: "codex",
        className: "size-5",
      }),
    );

    expect(html).toContain('viewBox="0 0 256 260"');
    expect(html).toContain("dark:fill-white");
    expect(html).toContain("size-5");
    expect(html).not.toContain("lucide-bot");
  });

  test("renders the Claude brand icon", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRuntimeIcon, {
        runtimeKind: "claude",
        className: "size-5",
      }),
    );

    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("fill-[#D97757]");
    expect(html).toContain("dark:fill-[#E8B09B]");
    expect(html).toContain("M4.709 15.955l4.72-2.647");
    expect(html).toContain("size-5");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("lucide-bot");
  });
});
