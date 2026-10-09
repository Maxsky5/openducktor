import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";

const renderIndicator = (totalTokens: number, contextWindow: number, outputLimit?: number) => {
  const rendered = render(
    <AgentContextUsageIndicator
      totalTokens={totalTokens}
      contextWindow={contextWindow}
      {...(outputLimit !== undefined ? { outputLimit } : {})}
    />,
  );
  const trigger = screen.getByRole("button", { name: /^Session context:/ });
  const tokens = trigger.querySelector("span");
  const arc = trigger.querySelectorAll("circle")[1];
  if (!tokens || !arc) throw new Error("Expected the context ring and token count");
  return { ...rendered, trigger, tokens, arc };
};

describe("AgentContextUsageIndicator", () => {
  test("shows the ring and the token count, and names the percent on the trigger", () => {
    const { trigger, tokens, arc } = renderIndicator(45_000, 200_000);

    expect(tokens.textContent).toBe("45K");
    expect(trigger.getAttribute("aria-label")).toBe("Session context: 22.5% used, 45K tokens");
    expect(arc.getAttribute("stroke-dasharray")).toBe("22.5 100");
  });

  test("opens the context details when the trigger gets keyboard focus", async () => {
    const { trigger } = renderIndicator(45_000, 200_000, 8_000);

    expect(screen.queryByText("Max context: 200,000 tokens")).toBeNull();
    fireEvent.focus(trigger);

    expect(await screen.findByRole("tooltip")).toBeDefined();
    expect(screen.getAllByText("22.5%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Used: 45,000 tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Max context: 200,000 tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Output limit: 8,000 tokens").length).toBeGreaterThan(0);
  });

  test("colors the token count and the ring by usage", () => {
    const low = renderIndicator(45_000, 200_000);
    expect(low.tokens.className).toContain("text-success-muted");
    low.unmount();

    const high = renderIndicator(160_000, 200_000);
    expect(high.tokens.className).toContain("text-warning-muted");
    high.unmount();

    const full = renderIndicator(190_000, 200_000);
    expect(full.tokens.className).toContain("text-destructive-muted");
    expect(full.arc.getAttribute("class")).toContain("stroke-destructive-accent");
  });

  test("fills the ring at most once when usage passes the context window", () => {
    const { trigger, arc } = renderIndicator(210_000, 200_000);

    expect(arc.getAttribute("stroke-dasharray")).toBe("100 100");
    expect(trigger.getAttribute("aria-label")).toBe("Session context: 105% used, 210K tokens");
  });
});
