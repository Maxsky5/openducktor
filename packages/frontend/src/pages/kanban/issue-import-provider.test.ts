import { describe, expect, mock, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { createGitProviderContextFixture } from "@/test-utils/shared-test-fixtures";
import {
  issueImportBlockedReason,
  runIssueImport,
  toIssueImportState,
} from "./issue-import-provider";

const readyProvider = () => ({
  ...createGitProviderContextFixture(),
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
});

describe("issue import state", () => {
  test("keeps a failed provider read apart from missing setup", () => {
    const failed = toIssueImportState(undefined, new Error("provider context unavailable"));
    const missing = toIssueImportState(createGitProviderContextFixture({ enabled: false }), null);

    expect(failed).toEqual({
      kind: "read_failed",
      reason: "Could not read the Git provider. provider context unavailable",
    });
    expect(missing.kind).toBe("setup_missing");
    expect(toIssueImportState(undefined, null)).toEqual({ kind: "loading" });
    expect(toIssueImportState(readyProvider(), null).kind).toBe("ready");
  });

  test("blocks import while the provider loads or after a failed read", () => {
    expect(issueImportBlockedReason({ kind: "loading" })).toBe("Loading the Git provider…");
    expect(issueImportBlockedReason({ kind: "read_failed", reason: "Read failed." })).toBe(
      "Read failed.",
    );
    expect(issueImportBlockedReason({ kind: "setup_missing", reason: "Set up." })).toBeNull();
  });

  test("opens Settings only for missing setup", () => {
    const openImport = mock(() => {});
    const openSettings = mock(() => {});

    runIssueImport({ kind: "read_failed", reason: "Read failed." }, { openImport, openSettings });
    runIssueImport({ kind: "loading" }, { openImport, openSettings });
    expect(openSettings).not.toHaveBeenCalled();
    expect(openImport).not.toHaveBeenCalled();

    runIssueImport({ kind: "setup_missing", reason: "Set up." }, { openImport, openSettings });
    expect(openSettings).toHaveBeenCalledTimes(1);

    const ready = toIssueImportState(readyProvider(), null);
    runIssueImport(ready, { openImport, openSettings });
    expect(openImport).toHaveBeenCalledTimes(1);
  });
});
