import { expect, test } from "bun:test";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PairingCodeInput } from "./pairing-code-input";

/** Gives each slot a 50 pixel box, as happy-dom has no layout, and returns a click for slot `n`. */
const layOut = (container: HTMLElement, input: HTMLInputElement) => {
  const slots = [...container.querySelectorAll<HTMLElement>("[data-code-slot]")];
  slots.forEach((slot, index) => {
    slot.getBoundingClientRect = () => DOMRect.fromRect({ x: index * 50, width: 40, height: 40 });
  });
  return (slot: number) => fireEvent.mouseDown(input, { clientX: slot * 50 + 20 });
};

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <PairingCodeInput aria-label="Pairing code" value={value} onChange={setValue} />;
}

test("a click on a digit selects it, and a replaced digit moves the selection to the next one", () => {
  const { container } = render(<Harness initial="123456" />);
  const input = screen.getByLabelText<HTMLInputElement>("Pairing code");
  const click = layOut(container, input);
  click(1);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 2]);
  // A browser replaces the selected digit and leaves the caret after it, then fires the event.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "193456");
  input.setSelectionRange(2, 2);
  fireEvent.input(input);
  expect(input.value).toBe("193456");
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 3]);
  // A click after the last digit puts the caret at the end of the code.
  click(5);
  expect([input.selectionStart, input.selectionEnd]).toEqual([5, 6]);
});

test("a click on an empty slot puts the caret after the typed digits", () => {
  const { container } = render(<Harness initial="12" />);
  const input = screen.getByLabelText<HTMLInputElement>("Pairing code");
  layOut(container, input)(4);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
});
