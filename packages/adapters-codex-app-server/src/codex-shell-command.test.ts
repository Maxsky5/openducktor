import { describe, expect, test } from "bun:test";
import { readCodexShellScript } from "./codex-shell-command";

describe("readCodexShellScript", () => {
  test("gives the script that Codex runs through a login shell", () => {
    expect(
      readCodexShellScript(
        `/bin/zsh -lc "rg -n --glob '*.mjs' --glob '"'!*.map'"' \\"databaseHooks|account\\" apps/api | head -35"`,
      ),
    ).toBe(`rg -n --glob '*.mjs' --glob '!*.map' "databaseHooks|account" apps/api | head -35`);
    expect(readCodexShellScript(`bash -lc 'git status --short'`)).toBe("git status --short");
    expect(readCodexShellScript(`/bin/sh -c "echo \\$HOME \\\\ done"`)).toBe("echo $HOME \\ done");
  });

  test("keeps a command that Codex runs without a shell", () => {
    expect(readCodexShellScript("rg -n foo src")).toBe("rg -n foo src");
    expect(readCodexShellScript("/bin/zsh -lc")).toBe("/bin/zsh -lc");
    expect(readCodexShellScript(`/bin/zsh -lc "echo 'open`)).toBe(`/bin/zsh -lc "echo 'open`);
  });
});
