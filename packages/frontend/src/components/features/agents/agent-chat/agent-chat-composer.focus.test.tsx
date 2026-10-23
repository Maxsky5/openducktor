import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { QueryProvider } from "@/test-utils/query-provider";
import { AgentChatComposer, buildModel } from "./agent-chat-composer-test-helpers";

test("focuses the selected session editor when it becomes interactive", () => {
  const model = buildModel();
  const view = render(<AgentChatComposer model={{ ...model, isInteractionEnabled: false }} />, {
    wrapper: QueryProvider,
  });

  expect(document.activeElement === model.composerEditorRef.current).toBe(false);

  view.rerender(<AgentChatComposer model={model} />);

  expect(document.activeElement === model.composerEditorRef.current).toBe(true);
  view.unmount();
});
