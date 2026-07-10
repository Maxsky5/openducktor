import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { act, createElement } from "react";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import {
  type AgentChatThreadModelInput,
  buildBaseModel,
  buildSession,
  completeThreadModel,
} from "./agent-chat-test-fixtures";
import { AgentChatThread as AgentChatThreadComponent } from "./agent-chat-thread";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const AgentChatThread = ({ model }: { model: AgentChatThreadModelInput }) =>
  createElement(
    AgentChatSettingsProvider,
    { value: createChatSettingsFixture() },
    createElement(AgentChatThreadComponent, { model: completeThreadModel(model) }),
  );

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("AgentChatThread runtime status", () => {
  test("renders a transient runtime status with informational styling", async () => {
    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildSession({
            runtimeStatusMessage:
              "Our systems are thinking a bit more about this request before responding.",
          }),
          isSessionWorking: true,
        },
      }),
    );
    await act(flush);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(
      "Our systems are thinking a bit more about this request before responding.",
    );
    expect(notice.className).toContain("border-info-border");
    expect(notice.className).toContain("bg-info-surface");
    expect(notice.className).toContain("text-info-surface-foreground");

    rendered.unmount();
  });
});
