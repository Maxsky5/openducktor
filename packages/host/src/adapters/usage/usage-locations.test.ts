import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveUsageLocations } from "./usage-locations";

const home = path.join(path.sep, "home", "u");

describe("resolveUsageLocations", () => {
  test("uses the default folder of each runtime", () => {
    expect(resolveUsageLocations({}, home)).toEqual({
      claude: path.join(home, ".claude", "projects"),
      codex: [
        path.join(home, ".codex", "sessions"),
        path.join(home, ".codex", "archived_sessions"),
      ],
      opencode: { directory: path.join(home, ".local", "share", "opencode"), databaseFile: null },
    });
  });

  test("follows the folder variables of each runtime", () => {
    const root = path.join(path.sep, "data");
    expect(
      resolveUsageLocations(
        {
          CLAUDE_CONFIG_DIR: path.join(root, "c"),
          CODEX_HOME: path.join(root, "x"),
          XDG_DATA_HOME: root,
          OPENCODE_DB: "custom.db",
        },
        home,
      ),
    ).toEqual({
      claude: path.join(root, "c", "projects"),
      codex: [path.join(root, "x", "sessions"), path.join(root, "x", "archived_sessions")],
      opencode: {
        directory: path.join(root, "opencode"),
        databaseFile: path.resolve(root, "opencode", "custom.db"),
      },
    });
  });
});
