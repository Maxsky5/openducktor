import { describe, expect, test } from "bun:test";
import {
  createDevServerTaskScope,
  formatDevServerTaskScopeKey,
  formatDevServerTerminalIdentityKey,
} from "./dev-server-task-scope";

describe("dev-server-task-scope", () => {
  test("formats task scope keys without delimiter collisions", () => {
    const left = formatDevServerTaskScopeKey(createDevServerTaskScope("/repo::task-b", "task-c"));
    const right = formatDevServerTaskScopeKey(createDevServerTaskScope("/repo", "task-b::task-c"));

    expect(left).not.toBe(right);
  });

  test("formats terminal identity keys without delimiter collisions", () => {
    const left = formatDevServerTerminalIdentityKey(
      formatDevServerTaskScopeKey(createDevServerTaskScope("/repo::task-b", "task-c")),
      "web",
    );
    const right = formatDevServerTerminalIdentityKey(
      formatDevServerTaskScopeKey(createDevServerTaskScope("/repo", "task-b::task-c")),
      "web",
    );

    expect(left).not.toBe(right);
  });
});
