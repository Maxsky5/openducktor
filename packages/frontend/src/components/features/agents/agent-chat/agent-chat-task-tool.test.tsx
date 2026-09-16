import { expect, test } from "bun:test";
import type { PublicTaskSummaryTask } from "@openducktor/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { createMessageCardElement } from "./agent-chat-message-card-test-harness";

const task = (id = "task-1"): PublicTaskSummaryTask => ({
  id,
  title: "Add task search shortcut",
  description: "Focus search with the keyboard.",
  status: "open",
  priority: 2,
  issueType: "task",
  labels: ["accessibility"],
  aiReviewEnabled: true,
  createdAt: "2026-09-08T10:00:00.000Z",
  updatedAt: "2026-09-08T10:00:00.000Z",
  qaVerdict: "not_reviewed",
  documents: { hasSpec: false, hasPlan: false, hasQaReport: false },
});

const createToolElement = (tool: string, fields: Partial<ToolMeta>) =>
  createMessageCardElement({
    message: {
      id: "m1",
      role: "tool",
      content: "",
      timestamp: "2026-09-08T10:00:00.000Z",
      meta: {
        kind: "tool",
        partId: "p1",
        callId: "c1",
        tool,
        toolType: "generic",
        status: "completed",
        ...fields,
      },
    },
    sessionAgentColors: {},
  });

const renderTool = (tool: string, fields: Partial<ToolMeta>): string =>
  renderToStaticMarkup(createToolElement(tool, fields));

test("renders create_task through the real message card as a Kanban-style task", () => {
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({ task: task() }),
  });
  expect(html).toContain('aria-label="create_task"');
  expect(html).toContain('data-task-id="task-1"');
  expect(html).not.toContain("Task created");
  expect(html).toContain("Add task search shortcut");
  expect(html).toContain("accessibility");
  expect(html).toContain("P2");
  expect(html).not.toContain("odt_create_task");
  const document = new DOMParser().parseFromString(html, "text/html");
  const section = document.querySelector("section");
  const regularTool = section?.firstElementChild;
  expect(regularTool?.querySelector("details > summary")?.textContent).toContain("create_task");
  expect(regularTool?.querySelector("details[open]")).toBeNull();
  expect(regularTool?.nextElementSibling?.getAttribute("data-task-id")).toBe("task-1");
  const card = document.querySelector('[data-task-id="task-1"]');
  expect(card?.querySelector("h3")?.textContent).toBe("Add task search shortcut");
  expect(card?.textContent?.indexOf("Add task search shortcut")).toBeLessThan(
    card?.textContent?.indexOf("task-1") ?? -1,
  );
  expect(card?.querySelector(".markdown-body")?.textContent).toBe(task().description);
  const openButton = card?.querySelector('button[aria-label="Open task details"]');
  expect(openButton?.textContent).toBe("Open");
  expect(openButton?.querySelector("svg.lucide-square-arrow-out-up-right")).not.toBeNull();
  expect(openButton?.parentElement?.textContent).toContain("task-1");
  expect(card?.querySelector("a[href]")).toBeNull();
  expect(card?.classList.contains("mb-3")).toBe(true);
  expect(html).not.toContain("Tool details");
});

test("renders search_tasks as a regular tool with filters and counts, never task cards", () => {
  const html = renderTool("odt_search_tasks", {
    input: {
      title: "login",
      status: "open",
      issueType: "feature",
      priority: 0,
      tags: ["auth", "web"],
      limit: 2,
    },
    output: JSON.stringify({
      results: [{ task: task() }, { task: task("task-2") }],
      limit: 2,
      totalCount: 5,
      hasMore: true,
    }),
  });
  expect(html).not.toContain("data-task-id");
  const document = new DOMParser().parseFromString(html, "text/html");
  const summary = document.querySelector("section > div > details > summary");
  expect(summary?.textContent).toContain(
    "5 results, 2 returned · title: login · status: open · type: feature · priority: P0 · tags: auth, web · limit: 2",
  );
  expect(document.querySelectorAll("h3")).toHaveLength(0);
  expect(document.querySelector("details[open]")).toBeNull();
  const empty = renderTool("odt_search_tasks", {
    input: { limit: 10 },
    output: JSON.stringify({ results: [], limit: 10, totalCount: 0, hasMore: false }),
  });
  expect(empty).toContain("0 results · limit: 10");
  expect(empty).not.toContain("data-task-id");
});

test("keeps a hundred search results inside the regular collapsed output", () => {
  const html = renderTool("odt_search_tasks", {
    input: { limit: 100 },
    output: JSON.stringify({
      results: Array.from({ length: 100 }, (_, index) => ({ task: task(`task-${index}`) })),
      limit: 100,
      totalCount: 500,
      hasMore: true,
    }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelectorAll("[data-task-id], h3")).toHaveLength(0);
  expect(document.querySelector("section > div > details > summary")?.textContent).toContain(
    "500 results, 100 returned",
  );
  expect(document.querySelectorAll("details")).toHaveLength(3);
  expect(document.querySelector("details[open]")).toBeNull();
});

test("search shows filters while pending and does not invent a count on failure", () => {
  for (const status of ["pending", "running", "error"] as const) {
    const html = renderTool("odt_search_tasks", {
      status,
      input: { status: "open", limit: 2 },
      error: "Search unavailable",
      output: "malformed",
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    const summary = document.querySelector("section > div > details > summary")?.textContent;
    if (status !== "error") expect(summary).toContain("status: open · limit: 2");
    expect(summary).not.toContain("results");
    if (status === "error") expect(summary).toContain("Search unavailable");
    expect(document.querySelectorAll("[data-task-id], h3")).toHaveLength(0);
  }
});

test("renders the description as a bounded markdown preview inside the five-line clamp", () => {
  const description = ["### Context", "", "- Failure: CI run", "", "b".repeat(4000)].join("\n");
  const html = renderTool("odt_create_task", {
    output: JSON.stringify({ task: { ...task(), description } }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.classList.contains("line-clamp-5")).toBe(true);
  expect(preview?.querySelector("h3")?.textContent).toBe("Context");
  expect(preview?.querySelector("li")?.textContent).toBe("Failure: CI run");
  expect(preview?.textContent).toContain("b".repeat(200));
  expect(preview?.textContent).not.toContain("b".repeat(1000));
  const card = document.querySelector("[data-task-id]");
  expect(card?.innerHTML).not.toContain("### Context");
  expect(card?.innerHTML).not.toContain("b".repeat(1000));
});

test("renders a task asset image as preview alt text without a task context alert", () => {
  const assetId = "550e8400-e29b-41d4-a716-446655440000";
  const description = [
    `![Screenshot](odt-asset:${assetId} "shot.png")`,
    `![](odt-asset:${assetId} "diagram.png")`,
    "",
    "b".repeat(2000),
  ].join("\n");
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({ task: { ...task(), description } }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.classList.contains("line-clamp-5")).toBe(true);
  expect(preview?.textContent).toContain("Screenshot");
  expect(preview?.textContent).toContain("diagram.png");
  expect(preview?.querySelector("svg.lucide-image")).not.toBeNull();
  expect(preview?.textContent).not.toContain("b".repeat(1000));
  expect(html).not.toContain("task context is unavailable");
  expect(document.querySelector("[data-task-id] img")).toBeNull();
});

test("labels a malformed task asset reference without a task context alert", () => {
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({
      task: { ...task(), description: "![](odt-asset:not-a-uuid)" },
    }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("Image");
  expect(html).not.toContain("task asset reference is invalid");
  expect(document.querySelector("[data-task-id] img")).toBeNull();
});

test("keeps a preview image chip when the image token crosses the preview budget", () => {
  const description = `${"a".repeat(470)}\n\n![Screenshot](odt-asset:550e8400-e29b-41d4-a716-446655440000 "shot.png")`;
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({ task: { ...task(), description } }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("Screenshot");
  expect(preview?.querySelector("svg.lucide-image")).not.toBeNull();
});

test("renders a description link as text without an anchor", () => {
  const description = "See [the docs](https://example.com/docs) for details.";
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({ task: { ...task(), description } }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("the docs");
  expect(preview?.querySelector("a[href]")).toBeNull();
});

test("does not load a remote image in the description preview", () => {
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({
      task: { ...task(), description: "![Architecture](https://example.com/diagram.png)" },
    }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("Architecture");
  expect(document.querySelector("[data-task-id] img")).toBeNull();
});

test("labels a preview image without alt text or a file name", () => {
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({
      task: { ...task(), description: "![](https://example.com/diagram.png)" },
    }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("Image");
  expect(document.querySelector("[data-task-id] img")).toBeNull();
});

test("strips front matter and renders a diagram fence as code in the description preview", () => {
  const description = [
    "---",
    "priority: high",
    "---",
    "",
    "Body text here.",
    "",
    "```mermaid",
    "graph TD",
    "  A --> B",
  ].join("\n");
  const html = renderTool("openducktor_odt_create_task", {
    output: JSON.stringify({ task: { ...task(), description } }),
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const preview = document.querySelector("[data-task-id] .markdown-body");
  expect(preview?.textContent).toContain("Body text here.");
  expect(preview?.textContent).not.toContain("priority: high");
  expect(preview?.textContent).toContain("graph TD");
  expect(preview?.querySelector(".language-mermaid")).not.toBeNull();
  expect(preview?.querySelector("section[aria-label='Mermaid diagram']")).toBeNull();
  expect(preview?.querySelector("svg")).toBeNull();
});

test("does not claim task creation before completion or after failure", () => {
  const input = { title: "Draft task" };
  for (const status of ["pending", "running", "error"] as const) {
    const fields: Partial<ToolMeta> = { status, input };
    if (status === "error") fields.error = "Database unavailable";
    const html = renderTool("odt_create_task", fields);
    expect(html).not.toContain("Task created");
    expect(html).not.toContain("data-task-id");
    if (status === "error") expect(html).toContain("Database unavailable");
    else expect(html).toContain("Draft task");
  }
});

test.each(["not JSON", JSON.stringify({ task: { id: "fake", title: "Incomplete" } })])(
  "reports invalid successful output without fabricating a task card",
  (output) => {
    const html = renderTool("odt_create_task", { output });
    expect(html).toContain("invalid task result");
    expect(html).not.toContain("Task created");
    expect(html).not.toContain("data-task-id");
    expect(html).toContain("Output");
  },
);
