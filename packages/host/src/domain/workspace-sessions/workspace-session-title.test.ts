import { expect, test } from "bun:test";
import type { AcceptedAgentUserMessage } from "@openducktor/contracts";
import {
  buildWorkspaceSessionTitle,
  workspaceSessionRuntimeTitle,
} from "./workspace-session-title";

const message = (parts: AcceptedAgentUserMessage["parts"]): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: "session",
  timestamp: "2026-09-07T00:00:00Z",
  messageId: "message",
  message: "not used as a title",
  parts,
  state: "read",
});

test("uses visible text, reference labels, and attachment names without hidden instructions", () => {
  expect(
    buildWorkspaceSessionTitle(
      message([
        { kind: "text", text: "  Review\n " },
        { kind: "text", text: "Hidden prompt", synthetic: true },
        {
          kind: "file_reference",
          file: { id: "file", path: "/private/full/path/main.ts", name: "main.ts", kind: "code" },
        },
        {
          kind: "attachment",
          attachment: {
            id: "image",
            path: "/private/picture.png",
            name: "picture.png",
            kind: "image",
          },
        },
      ]),
    ),
  ).toBe("Review main.ts picture.png");
});

test("limits titles at a word boundary with a complete ellipsis", () => {
  const title = buildWorkspaceSessionTitle(
    message([
      { kind: "text", text: "Investigate the Workspace Session creation failure in the host" },
    ]),
  );
  expect(title).toBe("Investigate the Workspace Session…");
  expect(title!.length).toBeLessThanOrEqual(40);
});

test("retains exact-limit titles and safely cuts long single words and emoji", () => {
  expect(buildWorkspaceSessionTitle(message([{ kind: "text", text: "a".repeat(40) }]))).toBe(
    "a".repeat(40),
  );
  expect(buildWorkspaceSessionTitle(message([{ kind: "text", text: "a".repeat(41) }]))).toBe(
    `${"a".repeat(39)}…`,
  );
  expect(buildWorkspaceSessionTitle(message([{ kind: "text", text: "😀".repeat(25) }]))).toBe(
    `${"😀".repeat(19)}…`,
  );
});

test("does not invent a title for empty visible content", () => {
  expect(
    buildWorkspaceSessionTitle(message([{ kind: "text", text: "hidden", synthetic: true }])),
  ).toBeNull();
});

test("prefers the manual title, falls back to the generated title, and stays undefined without a title", () => {
  expect(workspaceSessionRuntimeTitle({ generatedTitle: "Generated" }, "Manual")).toBe("Manual");
  expect(workspaceSessionRuntimeTitle({ generatedTitle: "Generated" }, null)).toBe("Generated");
  expect(workspaceSessionRuntimeTitle({ generatedTitle: "Generated" }, "  ")).toBe("Generated");
  expect(workspaceSessionRuntimeTitle({ generatedTitle: null }, null)).toBeNull();
});
