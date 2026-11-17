import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { useSessionEntrySelection } from "./session-navigation-selection";
import { SessionSelectionProvider } from "./session-selection-scope";

test("a session switch renders only the rows whose selection changed", () => {
  const renders = new Map<string, number>();
  function Row({ entryKey }: { entryKey: string }) {
    const { isSelected } = useSessionEntrySelection(entryKey);
    renders.set(entryKey, (renders.get(entryKey) ?? 0) + 1);
    return <span data-selected={isSelected}>{entryKey}</span>;
  }
  // The rows are memoized in the app; one stable element per row matches that here.
  const rows = ["a", "b", "c"].map((key) => <Row key={key} entryKey={key} />);
  const tree = (selected: string) => (
    <SessionSelectionProvider selection={{ entryKey: selected, visibleKey: selected }}>
      {rows}
    </SessionSelectionProvider>
  );
  const view = render(tree("a"));
  renders.clear();
  view.rerender(tree("b"));
  expect(renders.get("a")).toBe(1);
  expect(renders.get("b")).toBe(1);
  expect(renders.has("c")).toBe(false);
  expect(view.getByText("b").dataset.selected).toBe("true");
  view.unmount();
});
