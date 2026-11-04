import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";
import { SessionViewShownContext, useOnSessionViewHide } from "./session-view-context";

function Harness({ onHide }: { onHide: () => void }): ReactElement {
  useOnSessionViewHide(onHide);
  return <p>kept content</p>;
}

function Shown({ isShown, children }: { isShown: boolean; children: ReactNode }): ReactElement {
  return <SessionViewShownContext value={isShown}>{children}</SessionViewShownContext>;
}

test("runs onHide when the session view hides and keeps the content mounted", () => {
  const onHide = mock(() => {});
  const view = render(
    <Shown isShown>
      <Harness onHide={onHide} />
    </Shown>,
  );
  const content = view.getByText("kept content");
  expect(onHide).toHaveBeenCalledTimes(0);

  view.rerender(
    <Shown isShown={false}>
      <Harness onHide={onHide} />
    </Shown>,
  );
  expect(onHide).toHaveBeenCalledTimes(1);
  expect(content.isConnected).toBe(true);

  view.rerender(
    <Shown isShown>
      <Harness onHide={onHide} />
    </Shown>,
  );
  expect(onHide).toHaveBeenCalledTimes(1);
  expect(view.getByText("kept content")).toBe(content);
});

test("runs onHide when the content unmounts", () => {
  const onHide = mock(() => {});
  const view = render(
    <Shown isShown>
      <Harness onHide={onHide} />
    </Shown>,
  );
  expect(onHide).toHaveBeenCalledTimes(0);

  view.unmount();
  expect(onHide).toHaveBeenCalledTimes(1);
});
