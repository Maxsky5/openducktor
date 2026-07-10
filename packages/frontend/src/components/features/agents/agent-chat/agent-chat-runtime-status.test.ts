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

const BUFFERING_MESSAGE =
  "Our systems are thinking a bit more about this request before responding.";

const renderRuntimeStatus = ({
  runtimeStatusMessage,
  isSessionWorking,
}: {
  runtimeStatusMessage: string | null;
  isSessionWorking: boolean;
}) =>
  render(
    createElement(AgentChatThread, {
      model: {
        ...buildBaseModel(),
        session: buildSession({ runtimeStatusMessage }),
        isSessionWorking,
      },
    }),
  );

describe("AgentChatThread runtime status", () => {
  test("renders a transient runtime status with informational styling", async () => {
    const rendered = renderRuntimeStatus({
      runtimeStatusMessage: BUFFERING_MESSAGE,
      isSessionWorking: true,
    });
    await act(flush);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(BUFFERING_MESSAGE);
    expect(notice.className).toContain("border-info-border");
    expect(notice.className).toContain("bg-info-surface");
    expect(notice.className).toContain("text-info-surface-foreground");

    rendered.unmount();
  });

  test("does not render a runtime status outside its active display conditions", async () => {
    const hiddenCases = [
      { runtimeStatusMessage: BUFFERING_MESSAGE, isSessionWorking: false },
      { runtimeStatusMessage: null, isSessionWorking: true },
    ];

    for (const hiddenCase of hiddenCases) {
      const rendered = renderRuntimeStatus(hiddenCase);
      await act(flush);

      expect(screen.queryByRole("status")).toBeNull();
      rendered.unmount();
    }
  });
});
