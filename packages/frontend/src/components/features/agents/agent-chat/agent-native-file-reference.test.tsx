import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AgentNativeFileReferenceView } from "./agent-native-file-reference";

test("keeps native attachment bytes downloadable when the original path is unavailable", () => {
  const view = render(
    <AgentNativeFileReferenceView
      file={{
        name: "notes.txt",
        mime: "text/plain",
        uri: "file:///old-worktree/notes.txt",
        downloadUri: "data:text/plain;base64,S2VlcCB0aGlz",
      }}
    />,
  );
  try {
    expect(screen.getByText("file:///old-worktree/notes.txt")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Download attachment" });
    expect(link.getAttribute("href")).toBe("data:text/plain;base64,S2VlcCB0aGlz");
    expect(link.getAttribute("download")).toBe("notes.txt");
  } finally {
    view.unmount();
  }
});
