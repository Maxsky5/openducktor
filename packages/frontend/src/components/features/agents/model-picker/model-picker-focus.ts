import {
  type ModelPickerItem,
  modelPickerValueKey,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { type RefObject, useLayoutEffect } from "react";
import type { ListImperativeAPI } from "react-window";
import type { ModelPickerProps } from "./model-picker-types";

type PendingModelFocusArgs = {
  items: ModelPickerItem[];
  getModelDisabledReason: ModelPickerProps["getModelDisabledReason"];
  pendingFocusKey: RefObject<string | null>;
  focusedModelKey: RefObject<string | null>;
  modelButtonRefs: RefObject<Array<HTMLButtonElement | null>>;
  listRef: RefObject<ListImperativeAPI | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  renderedRows?: { startIndex: number; stopIndex: number };
};

export const recoverPendingModelFocus = ({
  items,
  getModelDisabledReason,
  pendingFocusKey,
  focusedModelKey,
  modelButtonRefs,
  listRef,
  searchInputRef,
  renderedRows,
}: PendingModelFocusArgs): boolean => {
  const key = pendingFocusKey.current;
  if (key === null) {
    return false;
  }
  const index = items.findIndex((item) => modelPickerValueKey(item.value) === key);
  if (index < 0 || getModelDisabledReason?.(items[index]!)) {
    pendingFocusKey.current = null;
    focusedModelKey.current = null;
    searchInputRef.current?.focus();
    return true;
  }
  if (renderedRows && (index < renderedRows.startIndex || index > renderedRows.stopIndex)) {
    if (!listRef.current) {
      throw new Error("Model list is unavailable for keyboard navigation.");
    }
    listRef.current.scrollToRow({ index, align: "auto" });
    return true;
  }
  const button = modelButtonRefs.current[index];
  if (button?.isConnected && !button.disabled) {
    pendingFocusKey.current = null;
    button.focus();
    return true;
  }
  if (!renderedRows) {
    if (!listRef.current) {
      throw new Error("Model list is unavailable for keyboard navigation.");
    }
    listRef.current.scrollToRow({ index, align: "auto" });
  }
  return true;
};

export const findSelectableModelIndex = (
  items: readonly ModelPickerItem[],
  getModelDisabledReason: ((item: ModelPickerItem) => string | null) | undefined,
  fromEnd: boolean,
): number | null => {
  for (let step = 0; step < items.length; step += 1) {
    const index = fromEnd ? items.length - 1 - step : step;
    if (!getModelDisabledReason?.(items[index]!)) {
      return index;
    }
  }
  return null;
};

export const findAdjacentSelectableModelIndex = (
  items: readonly ModelPickerItem[],
  getModelDisabledReason: ((item: ModelPickerItem) => string | null) | undefined,
  currentIndex: number,
  direction: 1 | -1,
): number | null => {
  for (let step = 1; step <= items.length; step += 1) {
    const targetIndex = (currentIndex + direction * step + items.length) % items.length;
    if (!getModelDisabledReason?.(items[targetIndex]!)) {
      return targetIndex;
    }
  }
  return null;
};

export function useModelPickerFocusRecovery({
  effectiveOpen,
  isSpeedOnly,
  items,
  effectiveGetModelDisabledReason,
  pendingFocusKey,
  focusedModelKey,
  modelButtonRefs,
  listRef,
  searchInputRef,
}: {
  effectiveOpen: boolean;
  isSpeedOnly: boolean;
  items: ModelPickerItem[];
  effectiveGetModelDisabledReason: ((item: ModelPickerItem) => string | null) | undefined;
  pendingFocusKey: RefObject<string | null>;
  focusedModelKey: RefObject<string | null>;
  modelButtonRefs: RefObject<Array<HTMLButtonElement | null>>;
  listRef: RefObject<ListImperativeAPI | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
}): void {
  useLayoutEffect(() => {
    if (
      effectiveOpen &&
      !isSpeedOnly &&
      recoverPendingModelFocus({
        items,
        getModelDisabledReason: effectiveGetModelDisabledReason,
        pendingFocusKey,
        focusedModelKey,
        modelButtonRefs,
        listRef,
        searchInputRef,
      })
    ) {
      return;
    }
    const focusedKey = focusedModelKey.current;
    if (
      !effectiveOpen ||
      isSpeedOnly ||
      focusedKey === null ||
      document.activeElement !== document.body
    ) {
      return;
    }
    const focusedIndex = items.findIndex((item) => modelPickerValueKey(item.value) === focusedKey);
    const button = focusedIndex >= 0 ? modelButtonRefs.current[focusedIndex] : null;
    if (button?.isConnected && !button.disabled) {
      button.focus();
      return;
    }
    focusedModelKey.current = null;
    searchInputRef.current?.focus();
  }, [
    effectiveGetModelDisabledReason,
    effectiveOpen,
    focusedModelKey,
    isSpeedOnly,
    items,
    listRef,
    modelButtonRefs,
    pendingFocusKey,
    searchInputRef,
  ]);
}
