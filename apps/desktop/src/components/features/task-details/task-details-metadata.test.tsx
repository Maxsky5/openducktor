import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { TaskDetailsMetadata } from "./task-details-metadata";

describe("TaskDetailsMetadata", () => {
  test("renders parent metadata and no longer duplicates the pull request tag", () => {
    const task = createTaskCardFixture({
      id: "TASK-9",
      parentId: "TASK-1",
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsMetadata, {
        task,
      }),
    );

    expect(html).toContain("Parent");
    expect(html).toContain("TASK-1");
    expect(html).not.toContain("PR #");
  });
});
