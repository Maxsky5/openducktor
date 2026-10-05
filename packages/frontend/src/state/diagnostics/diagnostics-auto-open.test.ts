import { describe, expect, test } from "bun:test";
import { createDiagnosticsAutoOpenOwner } from "./diagnostics-auto-open";

const noFailure = {
  hasHostBlockingFailure: false,
  workspaceId: null,
  hasWorkspaceBlockingFailure: false,
};

describe("createDiagnosticsAutoOpenOwner", () => {
  test("opens once for the first host failure, even without a workspace", () => {
    const owner = createDiagnosticsAutoOpenOwner();

    expect(owner.claim(noFailure)).toBe(false);
    expect(owner.claim({ ...noFailure, hasHostBlockingFailure: true })).toBe(true);
    expect(owner.claim({ ...noFailure, hasHostBlockingFailure: true })).toBe(false);
    // Recovery and a later failure do not reset the host acknowledgement.
    expect(owner.claim(noFailure)).toBe(false);
    expect(owner.claim({ ...noFailure, hasHostBlockingFailure: true })).toBe(false);
  });

  test("keeps host and per-workspace acknowledgements independent", () => {
    const owner = createDiagnosticsAutoOpenOwner();

    expect(owner.claim({ ...noFailure, hasHostBlockingFailure: true, workspaceId: "a" })).toBe(
      true,
    );
    expect(
      owner.claim({
        hasHostBlockingFailure: true,
        workspaceId: "a",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(true);
    expect(
      owner.claim({
        hasHostBlockingFailure: true,
        workspaceId: "a",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(false);
    expect(
      owner.claim({
        hasHostBlockingFailure: false,
        workspaceId: "b",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(true);
    // Switching back to a workspace does not reopen it.
    expect(
      owner.claim({
        hasHostBlockingFailure: false,
        workspaceId: "a",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(false);
  });

  test("acknowledges both causes when they first occur together", () => {
    const owner = createDiagnosticsAutoOpenOwner();

    expect(
      owner.claim({
        hasHostBlockingFailure: true,
        workspaceId: "a",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(true);
    expect(owner.claim({ ...noFailure, hasHostBlockingFailure: true })).toBe(false);
    expect(
      owner.claim({
        hasHostBlockingFailure: false,
        workspaceId: "a",
        hasWorkspaceBlockingFailure: true,
      }),
    ).toBe(false);
  });
});
