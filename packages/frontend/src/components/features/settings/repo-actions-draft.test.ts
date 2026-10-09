import { describe, expect, test } from "bun:test";
import type { RepoAction, RepoActions } from "@openducktor/contracts";
import {
  addRepoAction,
  createRepoAction,
  deleteRepoAction,
  moveRepoAction,
  NEW_REPO_ACTION_FIELDS,
  setDefaultRepoAction,
  updateRepoAction,
  validateRepoActionFields,
} from "./repo-actions-draft";

const createAction = (id: string): RepoAction => ({
  id,
  icon: "play",
  name: id,
  command: `bun run ${id}`,
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
});

const createActions = (ids: string[], defaultActionId: string | null): RepoActions => ({
  items: ids.map(createAction),
  defaultActionId,
});

const itemIds = (actions: RepoActions): string[] => actions.items.map((item) => item.id);

describe("repo actions draft", () => {
  test("gives each new action a unique id", () => {
    const first = createRepoAction({
      ...NEW_REPO_ACTION_FIELDS,
      name: "Test",
      command: "bun test",
    });
    const second = createRepoAction({
      ...NEW_REPO_ACTION_FIELDS,
      name: "Lint",
      command: "bun lint",
    });

    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ name: "Test", command: "bun test", icon: "play" });
  });

  test("makes the first added action the default and keeps the default after that", () => {
    const withFirst = addRepoAction(createActions([], null), createAction("dev"));
    const withSecond = addRepoAction(withFirst, createAction("test"));

    expect(withFirst).toEqual(createActions(["dev"], "dev"));
    expect(withSecond).toEqual(createActions(["dev", "test"], "dev"));
  });

  test("makes the first remaining action the default when the default is deleted", () => {
    expect(deleteRepoAction(createActions(["dev", "test", "lint"], "test"), "test")).toEqual(
      createActions(["dev", "lint"], "dev"),
    );
    expect(deleteRepoAction(createActions(["dev", "test"], "dev"), "dev")).toEqual(
      createActions(["test"], "test"),
    );
  });

  test("keeps the default when another action is deleted", () => {
    expect(deleteRepoAction(createActions(["dev", "test"], "test"), "dev")).toEqual(
      createActions(["test"], "test"),
    );
  });

  test("clears the default when the last action is deleted", () => {
    expect(deleteRepoAction(createActions(["dev"], "dev"), "dev")).toEqual(createActions([], null));
  });

  test("moves an action up or down and keeps the order at the ends", () => {
    const actions = createActions(["dev", "test", "lint"], "dev");

    expect(itemIds(moveRepoAction(actions, "lint", "up"))).toEqual(["dev", "lint", "test"]);
    expect(itemIds(moveRepoAction(actions, "dev", "down"))).toEqual(["test", "dev", "lint"]);
    expect(moveRepoAction(actions, "dev", "up")).toBe(actions);
    expect(moveRepoAction(actions, "lint", "down")).toBe(actions);
  });

  test("sets the default action", () => {
    expect(setDefaultRepoAction(createActions(["dev", "test"], "dev"), "test")).toEqual(
      createActions(["dev", "test"], "test"),
    );
  });

  test("edits an action in place and keeps its id", () => {
    const edited = updateRepoAction(createActions(["dev", "test"], "dev"), "test", {
      icon: "test",
      name: "Unit tests",
      command: "bun test --watch",
      runOnWorktreeCreate: true,
      waitBeforeAgentStart: true,
    });

    expect(edited.items).toEqual([
      createAction("dev"),
      {
        id: "test",
        icon: "test",
        name: "Unit tests",
        command: "bun test --watch",
        runOnWorktreeCreate: true,
        waitBeforeAgentStart: true,
      },
    ]);
    expect(edited.defaultActionId).toBe("dev");
  });

  test("requires a name and a command that are not blank", () => {
    expect(
      validateRepoActionFields({ ...NEW_REPO_ACTION_FIELDS, name: " ", command: "\n" }),
    ).toEqual({ name: "Enter an action name.", command: "Enter a command." });
    expect(
      validateRepoActionFields({ ...NEW_REPO_ACTION_FIELDS, name: "Setup", command: "# later\n" }),
    ).toEqual({ command: "Add a command line. Lines that start with # are comments." });
    expect(
      validateRepoActionFields({ ...NEW_REPO_ACTION_FIELDS, name: "Test", command: "bun test" }),
    ).toEqual({});
  });
});
