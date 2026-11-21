import { createUnavailableShellBridge, type ShellBridge } from "@/lib/shell-bridge";
import { ShellPlatformContext } from "@/lib/shell-platform";
import { createElement, type ReactNode } from "react";
import type { HostClient } from "@openducktor/host-client";
import { createHostClientFixture } from "@openducktor/frontend-core/test-support/focused-fixture";

export const withShellPlatform = (children: ReactNode, value: ShellBridge) =>
  createElement(ShellPlatformContext, { value }, children);

type ShellBridgeFixtureOptions = {
  client?: Partial<HostClient>;
  bridge?: Partial<ShellBridge>;
};

export const createShellBridgeFixture = ({
  client = {},
  bridge = {},
}: ShellBridgeFixtureOptions = {}): ShellBridge => ({
  ...createUnavailableShellBridge(),
  client: createHostClientFixture(client),
  ...bridge,
});

export const createFileListFixture = (files: readonly File[]): FileList =>
  Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });

export const createDataTransferItemFixture = ({
  file = null,
  kind,
  type,
}: {
  file?: File | null;
  kind: DataTransferItem["kind"];
  type: string;
}): DataTransferItem => ({
  kind,
  type,
  getAsFile: () => file,
  getAsString: (callback) => callback?.(""),
  webkitGetAsEntry: () => null,
});

export const createDataTransferItemListFixture = (
  items: readonly DataTransferItem[],
): DataTransferItemList =>
  Object.assign([...items], {
    add: () => null,
    clear: () => {},
    remove: () => {},
  });

export const createDataTransferFixture = ({
  files = createFileListFixture([]),
  items = createDataTransferItemListFixture([]),
  types = [],
}: {
  files?: FileList;
  items?: DataTransferItemList;
  types?: string[];
} = {}): DataTransfer => {
  const data = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files,
    items,
    types,
    clearData: (format) => {
      if (format === undefined) {
        data.clear();
      } else {
        data.delete(format);
      }
    },
    getData: (format) => data.get(format) ?? "",
    setData: (format, value) => {
      data.set(format, value);
    },
    setDragImage: () => {},
  };
};
