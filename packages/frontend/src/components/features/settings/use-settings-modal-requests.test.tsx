import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useSettingsModalRequests } from "./use-settings-modal-requests";

test("keeps the active editor and pairs only its open and close callbacks", () => {
  const first = mock((_open: boolean) => {});
  const second = mock((_open: boolean) => {});
  const hook = renderHook(useSettingsModalRequests);
  act(() => {
    hook.result.current.openSettings({
      onOpenChange: first,
      deepLink: { kind: "repository-dev-servers", repositoryPath: "/repo" },
    });
    hook.result.current.openSettings({
      onOpenChange: second,
      deepLink: { kind: "global", section: "notifications" },
    });
  });
  const editor = hook.result.current.activeRequest;
  act(() => hook.result.current.openSettings({ onOpenChange: second }));
  expect(hook.result.current.activeRequest).toBe(editor);
  expect(second).not.toHaveBeenCalled();
  act(() => {
    hook.result.current.handleOpenChange(false);
    hook.result.current.handleOpenChange(false);
  });
  expect(first.mock.calls).toEqual([[true], [false]]);
  act(() => hook.result.current.openSettings({ onOpenChange: second }));
  expect(hook.result.current.activeRequest?.id).not.toBe(editor?.id);
  expect(second).toHaveBeenCalledWith(true);
  hook.unmount();
});
