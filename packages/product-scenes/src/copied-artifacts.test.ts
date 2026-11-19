import { describe, expect, test } from "bun:test";
import { artifactFormat, fileSize } from "./replicas/format";
import { artifactCardTitle } from "./replicas/transcript/ArtifactCard";
import { TASK_ID } from "./sample/studio";
import { ARTIFACT_GROUPS, MOCKUP, MOCKUP_CODE, MOCKUP_FILE } from "./scenes/artifacts/sample";
import { importProduct } from "./test-support/product-source";

type ToolCall = {
  kind: "tool";
  tool: string;
  status: "running" | "completed";
  input: Record<string, string>;
  output?: string;
};

// SAFETY: artifact-presentation.ts exports these functions, and a missing export fails the test.
const presentation = await importProduct<{
  artifactFormatLabel: (mediaType: string) => string;
  formatFileSize: (bytes: number) => string;
}>("packages/frontend-core/src/tasks/artifacts/artifact-presentation.ts");
// SAFETY: artifact-tool-call.ts exports this function, and a missing export fails the test.
const { readArtifactToolCall } = await importProduct<{
  readArtifactToolCall: (meta: ToolCall) => { heading: string; title: string };
}>("packages/frontend-core/src/sessions/messages/artifact-tool-call.ts");

/** The odt_set_task_artifact call of the Builder that saves the mockup. */
const input = {
  taskId: TASK_ID,
  code: MOCKUP_CODE,
  name: MOCKUP.name,
  fileName: MOCKUP_FILE,
  mediaType: MOCKUP.mediaType,
};

describe("the artifacts copied from the app", () => {
  test("the collection names the format and the size of each artifact as the app does", () => {
    const types = ["text/markdown", "text/plain", "TEXT/HTML", "image/svg+xml", "font/woff2"];
    for (const mediaType of types)
      expect(artifactFormat(mediaType)).toBe(presentation.artifactFormatLabel(mediaType));
    for (const bytes of [0, 1023, 1024, MOCKUP.bytes, 1024 * 1024, 10 * 1024 * 1024])
      expect(fileSize(bytes)).toBe(presentation.formatFileSize(bytes));
    const artifacts = [...ARTIFACT_GROUPS.workflow, ...ARTIFACT_GROUPS.files];
    expect(artifacts.map(({ mediaType }) => artifactFormat(mediaType))).toEqual([
      "Markdown",
      "Markdown",
      "HTML",
    ]);
  });

  test("the card of the save shows the title of the app, while it runs and after it", () => {
    const running = readArtifactToolCall({
      kind: "tool",
      tool: "odt_set_task_artifact",
      status: "running",
      input,
    });
    const saved = readArtifactToolCall({
      kind: "tool",
      tool: "odt_set_task_artifact",
      status: "completed",
      input,
      output: JSON.stringify({
        artifact: {
          taskId: TASK_ID,
          name: MOCKUP.name,
          revision: 1,
          updatedAt: "2026-11-15T09:47:31.000Z",
          classification: "free",
          code: MOCKUP_CODE,
          fileName: MOCKUP_FILE,
          mediaType: MOCKUP.mediaType,
          byteSize: MOCKUP.bytes,
        },
      }),
    });
    // HEADING_ICONS of agent-chat-artifact-tool-message.tsx gives FileText to "artifact" and File
    // to "free", the icons that the card shows while it runs and after the save.
    expect(running).toMatchObject({ heading: "artifact", title: artifactCardTitle(MOCKUP.name) });
    expect(saved).toMatchObject({ heading: "free", title: artifactCardTitle(MOCKUP.name) });
  });
});
