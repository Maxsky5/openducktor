import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";

const renderIndicator = (totalTokens: number, contextWindow: number) => {
  const html = renderToStaticMarkup(
    <AgentContextUsageIndicator totalTokens={totalTokens} contextWindow={contextWindow} />,
  );
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const meter = root.querySelector("meter");
  const row = meter?.parentElement;
  const tokens = row?.querySelector(":scope > span");
  const arc = row?.querySelectorAll("circle")[1];
  if (!meter || !row || !tokens || !arc) throw new Error("Expected the context ring row");
  return { root, meter, tokens, arc };
};

describe("AgentContextUsageIndicator", () => {
  test("shows the ring and the token count, with the percent in the tooltip and the meter", () => {
    const { root, meter, tokens, arc } = renderIndicator(45_000, 200_000);

    expect(tokens.textContent).toBe("45K");
    expect(meter.getAttribute("aria-label")).toBe("Session context");
    expect(meter.getAttribute("value")).toBe("22.5");
    expect(meter.className).toContain("sr-only");
    expect(arc.getAttribute("stroke-dasharray")).toBe("22.5 100");
    expect(root.textContent).toContain("22.5%");
    expect(root.textContent).toContain("Max context: 200,000 tokens");
  });

  test("colors the token count and the ring by usage", () => {
    expect(renderIndicator(45_000, 200_000).tokens.className).toContain("text-success-muted");
    expect(renderIndicator(160_000, 200_000).tokens.className).toContain("text-warning-muted");
    const full = renderIndicator(190_000, 200_000);
    expect(full.tokens.className).toContain("text-destructive-muted");
    expect(full.arc.getAttribute("class")).toContain("stroke-destructive-accent");
  });

  test("fills the ring at most once when usage passes the context window", () => {
    const { root, meter, arc } = renderIndicator(210_000, 200_000);

    expect(arc.getAttribute("stroke-dasharray")).toBe("100 100");
    expect(meter.getAttribute("value")).toBe("100");
    expect(root.textContent).toContain("105%");
  });
});
