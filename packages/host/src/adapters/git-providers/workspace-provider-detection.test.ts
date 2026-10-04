import { describe, expect, test } from "bun:test";
import { detectWorkspaceProviders } from "./workspace-provider-detection";

describe("workspace provider detection", () => {
  test("deduplicates fetch, effective push, and remote aliases without choosing a publish remote", () => {
    const result = detectWorkspaceProviders([
      {
        name: "origin",
        fetchUrls: ["https://github.com/Org/Repo.git"],
        pushUrls: ["git@github.com:org/repo.git"],
      },
      { name: "copy", fetchUrls: ["ssh://git@github.com/org/repo"], pushUrls: [] },
    ]);
    expect(result.outcome).toBe("detected");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.remoteNames).toEqual(["origin", "copy"]);
    expect(result.candidates[0]?.config.autoDetected).toBe(true);
  });
  test.each([
    "https://dev.azure.com/org/project/_git/repo",
    "git@ssh.dev.azure.com:v3/org/project/repo",
    "https://org.visualstudio.com/project/_git/repo",
    "https://ado.example.test/tfs/collection/project/_git/repo",
  ])("recognizes supported Azure identity: %s", (url) => {
    const result = detectWorkspaceProviders([{ name: "origin", fetchUrls: [url], pushUrls: [] }]);
    expect(result.outcome).toBe("detected");
    expect(result.candidates[0]?.config.id).toBe("azure_devops");
  });
  test("keeps distinct push identities and providers ambiguous", () => {
    for (const push of [
      "https://github.com/org/other.git",
      "https://dev.azure.com/org/project/_git/repo",
    ]) {
      const result = detectWorkspaceProviders([
        { name: "origin", fetchUrls: ["https://github.com/org/repo.git"], pushUrls: [push] },
      ]);
      expect(result.outcome).toBe("ambiguous");
      expect(result.candidates).toHaveLength(2);
    }
  });
  test("does not infer GitHub from a generic host or Azure from an SSH alias", () => {
    const result = detectWorkspaceProviders([
      {
        name: "origin",
        fetchUrls: [
          "https://git.example.test/org/repo",
          "git@ado-alias:project/repo",
          "file:///local/repo",
        ],
        pushUrls: [],
      },
    ]);
    expect(result).toEqual({ outcome: "none", candidates: [] });
  });
});
