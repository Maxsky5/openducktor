import { expect, test } from "bun:test";
import type { AcceptedAgentUserMessage } from "@openducktor/contracts";
import {
  buildWorkspaceSessionTitle,
  planRuntimeTitleRename,
  runtimeTitle,
  runtimeTitleWithManualTitle,
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
  const exact = buildWorkspaceSessionTitle(message([{ kind: "text", text: "a".repeat(40) }]));
  expect(exact).toBe("a".repeat(40));
  expect(exact!.length).toBe(40);
  const singleWord = buildWorkspaceSessionTitle(message([{ kind: "text", text: "a".repeat(41) }]));
  expect(singleWord).toBe(`${"a".repeat(39)}…`);
  expect(singleWord!.length).toBe(40);
  const emoji = buildWorkspaceSessionTitle(message([{ kind: "text", text: "😀".repeat(25) }]));
  expect(emoji).toBe(`${"😀".repeat(19)}…`);
  expect(emoji!.length).toBeLessThanOrEqual(40);
});

test("does not invent a title for empty visible content", () => {
  expect(
    buildWorkspaceSessionTitle(message([{ kind: "text", text: "hidden", synthetic: true }])),
  ).toBeNull();
});

test("prefers the manual title, falls back to the generated title, and stays undefined without a title", () => {
  expect(runtimeTitleWithManualTitle({ generatedTitle: "Generated" }, "Manual")).toBe("Manual");
  expect(runtimeTitleWithManualTitle({ generatedTitle: "Generated" }, null)).toBe("Generated");
  expect(runtimeTitleWithManualTitle({ generatedTitle: "Generated" }, "  ")).toBe("Generated");
  expect(runtimeTitle({ generatedTitle: null, manualTitle: null })).toBeNull();
  expect(runtimeTitle({ generatedTitle: "Generated", manualTitle: "Stored" })).toBe("Stored");
  expect(runtimeTitle({ generatedTitle: "Generated", manualTitle: null })).toBe("Generated");
});

test("plans a runtime rename only for a changed title on a bound session", () => {
  expect(
    planRuntimeTitleRename(
      { externalSessionId: "native", generatedTitle: null, manualTitle: null },
      "Manual",
    ),
  ).toEqual({ externalSessionId: "native", title: "Manual" });
  expect(
    planRuntimeTitleRename(
      { externalSessionId: "native", generatedTitle: null, manualTitle: "Manual" },
      "Manual",
    ),
  ).toBeNull();
  expect(
    planRuntimeTitleRename(
      { externalSessionId: null, generatedTitle: null, manualTitle: null },
      "Manual",
    ),
  ).toBeNull();
  expect(
    planRuntimeTitleRename(
      { externalSessionId: "native", generatedTitle: null, manualTitle: "Manual" },
      null,
    ),
  ).toBeNull();
});
