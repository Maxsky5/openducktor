import { type AgentModelSelection, STANDARD_SPEED } from "@openducktor/core";
import {
  buildModelPickerItems,
  isSameModelPickerValue,
  type ModelPickerFavoriteState,
  type ModelPickerRuntime,
  type ModelPickerSelectionPolicy,
  type ModelPickerValue,
  type ModelPickerView,
  modelPickerValueKey,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  resolveModelPickerActiveView,
  resolveModelPickerPresentation,
  resolveModelTriggerSummary,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import { Search } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ListImperativeAPI } from "react-window";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  findAdjacentSelectableModelIndex,
  findSelectableModelIndex,
  recoverPendingModelFocus,
  useModelPickerFocusRecovery,
} from "./model-picker-focus";
import { ModelPickerFocusContext } from "./model-picker-focus-context";
import {
  ModelPickerFavoriteNotice,
  ModelPickerList,
  ModelPickerLoadingNotice,
  ModelPickerResourceNotice,
} from "./model-picker-list";
import { ModelPickerOptionsPane } from "./model-picker-options-pane";
import { ModelPickerRail } from "./model-picker-rail";
import { ModelPickerTrigger } from "./model-picker-trigger";
import type {
  ModelPickerOptionsPane as ModelPickerOptionsPaneModel,
  ModelPickerProps,
} from "./model-picker-types";

const buildTriggerSelection = (
  value: ModelPickerValue | null,
  options: ModelPickerOptionsPaneModel,
): AgentModelSelection | null => {
  if (!value) return null;
  const selection: AgentModelSelection = {
    runtimeKind: value.runtimeKind,
    providerId: value.providerId,
    modelId: value.modelId,
  };
  if (options.effort.value) selection.variant = options.effort.value;
  if (options.profile?.value) selection.profileId = options.profile.value;
  if (options.speed?.control?.choice && options.speed.control.choice !== STANDARD_SPEED) {
    selection.speed = options.speed.control.choice;
  }
  return selection;
};

const resolveModelPickerSummary = ({
  selectedRuntime,
  value,
  options,
  placeholder,
  closedDisabledReason,
}: {
  selectedRuntime: ModelPickerRuntime | undefined;
  value: ModelPickerValue | null;
  options: ModelPickerOptionsPaneModel;
  placeholder: string;
  closedDisabledReason: string | null;
}) =>
  resolveModelTriggerSummary({
    runtime: selectedRuntime?.descriptor ?? null,
    catalog: selectedRuntime?.resource.catalog ?? null,
    selection: buildTriggerSelection(value, options),
    speed: options.speed?.control ?? null,
    profileOptions: options.profile?.options,
    effortOptions: options.effort.options,
    placeholder,
    disabledReason: closedDisabledReason,
    supportsProfiles:
      Boolean(options.profile) &&
      (selectedRuntime?.descriptor.capabilities.optionalSurfaces.supportsProfiles ?? false),
    supportsVariants:
      selectedRuntime?.descriptor.capabilities.optionalSurfaces.supportsVariants ?? true,
    supportsSpeed:
      Boolean(options.speed) &&
      (selectedRuntime ? selectedRuntime.descriptor.capabilities.speed.support !== "none" : false),
  });

const EMPTY_PRESENTATION = {
  visibleResources: [],
  emptyMessage: null,
} satisfies {
  visibleResources: readonly ModelPickerRuntime[];
  emptyMessage: string | null;
};

const isNestedPopoverTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-slot='popover-content']") !== null;

function useModelPickerController({
  runtimes,
  value,
  favoriteState,
  selectionPolicy,
  options,
  closedTriggerDisabledReason,
  onValueChange,
  getModelDisabledReason,
  placeholder,
  onOpenChange,
}: Pick<
  ModelPickerProps,
  "runtimes" | "value" | "favoriteState" | "selectionPolicy" | "options" | "onValueChange"
> & {
  getModelDisabledReason: ModelPickerProps["getModelDisabledReason"] | undefined;
  onOpenChange: ModelPickerProps["onOpenChange"] | undefined;
  closedTriggerDisabledReason: string | null;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<ModelPickerView>(() =>
    resolveModelPickerActiveView(
      runtimes,
      favoriteState.favorites,
      selectionPolicy,
      value?.runtimeKind,
    ),
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const speedFocusRef = useRef<HTMLElement | null>(null);
  const popoverContentRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const pendingFocusKey = useRef<string | null>(null);
  const focusedModelKey = useRef<string | null>(null);
  const wasOpenBeforeReadOnlyRef = useRef(false);
  const lastEmittedValueRef = useRef<ModelPickerValue | null>(null);

  useEffect(() => {
    lastEmittedValueRef.current = null;
  }, [value]);

  const isSpeedOnly = selectionPolicy.kind === "speed_only";
  const readOnlyReason = selectionPolicy.kind === "read_only" ? selectionPolicy.reason : null;
  if (open && readOnlyReason !== null) {
    setOpen(false);
  }
  const effectiveOpen = open && readOnlyReason === null;
  const closedDisabledReason = readOnlyReason ?? closedTriggerDisabledReason ?? null;
  const triggerBlocked = !effectiveOpen && closedDisabledReason !== null;
  const lockedRuntimeKind =
    selectionPolicy.kind === "runtime_locked" || selectionPolicy.kind === "speed_only"
      ? selectionPolicy.runtimeKind
      : null;

  const effectiveGetModelDisabledReason = useMemo(
    () => (isSpeedOnly ? () => selectionPolicy.reason : getModelDisabledReason),
    [getModelDisabledReason, isSpeedOnly, selectionPolicy],
  );

  useEffect(() => {
    if (effectiveOpen) {
      wasOpenBeforeReadOnlyRef.current = true;
      return;
    }
    if (wasOpenBeforeReadOnlyRef.current && readOnlyReason !== null) {
      wasOpenBeforeReadOnlyRef.current = false;
      pendingFocusKey.current = null;
      focusedModelKey.current = null;
      onOpenChange?.(false);
    }
  }, [effectiveOpen, onOpenChange, readOnlyReason]);

  // Skip catalog indexing and presentation scans while closed (e.g. 6+ pickers in Settings).
  const items = useMemo(
    () =>
      effectiveOpen
        ? buildModelPickerItems({
            runtimes,
            favorites: favoriteState.favorites,
            activeView,
            searchQuery,
            lockedRuntimeKind,
          })
        : [],
    [effectiveOpen, activeView, favoriteState.favorites, lockedRuntimeKind, runtimes, searchQuery],
  );

  useModelPickerFocusRecovery({
    effectiveOpen,
    isSpeedOnly,
    items,
    effectiveGetModelDisabledReason,
    pendingFocusKey,
    focusedModelKey,
    modelButtonRefs,
    listRef,
    searchInputRef,
  });

  const { visibleResources, emptyMessage } = useMemo(
    () =>
      effectiveOpen
        ? resolveModelPickerPresentation({
            runtimes,
            activeView,
            searchQuery,
            favoriteState,
            lockedRuntimeKind,
          })
        : EMPTY_PRESENTATION,
    [effectiveOpen, runtimes, activeView, searchQuery, favoriteState, lockedRuntimeKind],
  );

  const selectedRuntime = runtimes.find(
    (runtime) => runtime.descriptor.kind === value?.runtimeKind,
  );
  const summary = resolveModelPickerSummary({
    selectedRuntime,
    value,
    options,
    placeholder,
    closedDisabledReason,
  });

  const focusModel = (index: number | null): void => {
    if (index === null) return;
    const button = modelButtonRefs.current[index];
    if (button) {
      pendingFocusKey.current = null;
      button.focus();
      return;
    }
    if (!listRef.current) {
      throw new Error("Model list is unavailable for keyboard navigation.");
    }
    pendingFocusKey.current = modelPickerValueKey(items[index]!.value);
    listRef.current.scrollToRow({ index, align: "auto" });
  };

  const onNavigate = (index: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): void => {
    const target =
      key === "ArrowDown" || key === "ArrowUp"
        ? findAdjacentSelectableModelIndex(
            items,
            effectiveGetModelDisabledReason,
            index,
            key === "ArrowDown" ? 1 : -1,
          )
        : findSelectableModelIndex(items, effectiveGetModelDisabledReason, key === "End");
    focusModel(target);
  };

  const onSelect = (index: number, close: boolean): void => {
    const item = items[index]!;
    if (effectiveGetModelDisabledReason?.(item)) return;
    const alreadySelected =
      isSameModelPickerValue(value, item.value) ||
      (lastEmittedValueRef.current !== null &&
        isSameModelPickerValue(lastEmittedValueRef.current, item.value));
    if (!alreadySelected) {
      lastEmittedValueRef.current = item.value;
      onValueChange(item.value);
    }
    if (close) {
      wasOpenBeforeReadOnlyRef.current = false;
      pendingFocusKey.current = null;
      focusedModelKey.current = null;
      lastEmittedValueRef.current = null;
      setSearchQuery("");
      setOpen(false);
      onOpenChange?.(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen && closedDisabledReason !== null) return;
    lastEmittedValueRef.current = null;
    if (nextOpen) {
      setActiveView(
        resolveModelPickerActiveView(
          runtimes,
          favoriteState.favorites,
          selectionPolicy,
          value?.runtimeKind,
        ),
      );
      const activeElement = document.activeElement;
      setPortalContainer(
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
          : null,
      );
    } else {
      wasOpenBeforeReadOnlyRef.current = false;
      pendingFocusKey.current = null;
      focusedModelKey.current = null;
    }
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const onRowsRendered = (allRows: { startIndex: number; stopIndex: number }): void => {
    if (
      isSpeedOnly ||
      recoverPendingModelFocus({
        items,
        getModelDisabledReason: effectiveGetModelDisabledReason,
        pendingFocusKey,
        focusedModelKey,
        modelButtonRefs,
        listRef,
        searchInputRef,
        renderedRows: allRows,
      })
    ) {
      return;
    }
    const focusedKey = focusedModelKey.current;
    if (focusedKey === null || document.activeElement !== document.body) return;
    const focusedIndex = items.findIndex((item) => modelPickerValueKey(item.value) === focusedKey);
    if (focusedIndex < allRows.startIndex || focusedIndex > allRows.stopIndex) {
      focusedModelKey.current = null;
      searchInputRef.current?.focus();
    }
  };

  const focusPopoverFallback = useCallback((): void => {
    const content = popoverContentRef.current;
    if (!content?.isConnected) return;
    if (!isSpeedOnly && searchInputRef.current && !searchInputRef.current.disabled) {
      searchInputRef.current.focus();
      return;
    }
    const interactive = content.querySelector<HTMLElement>(
      "button:not([disabled]):not([aria-disabled='true']), [role='slider']:not([aria-disabled='true'])",
    );
    (interactive ?? content).focus();
  }, [isSpeedOnly]);

  const setSpeedFocusNode = useCallback((element: HTMLElement | null): void => {
    speedFocusRef.current = element;
  }, []);

  const registerButton = useCallback((index: number, element: HTMLButtonElement | null): void => {
    modelButtonRefs.current[index] = element;
  }, []);

  const onModelFocus = useCallback((modelKey: string): void => {
    focusedModelKey.current = modelKey;
  }, []);

  const onModelBlur = useCallback((modelKey: string, relatedTarget: EventTarget | null): void => {
    if (relatedTarget && relatedTarget !== document.body && focusedModelKey.current === modelKey) {
      focusedModelKey.current = null;
    }
  }, []);

  const focusInitialPopoverControl = (): void => {
    if (isSpeedOnly) {
      if (speedFocusRef.current?.isConnected) {
        speedFocusRef.current.focus();
        return;
      }
      focusPopoverFallback();
      return;
    }
    searchInputRef.current?.focus();
  };

  return {
    effectiveOpen,
    closedDisabledReason,
    triggerBlocked,
    isSpeedOnly,
    activeView,
    searchQuery,
    setSearchQuery,
    portalContainer,
    searchInputRef,
    popoverContentRef,
    listRef,
    items,
    visibleResources,
    emptyMessage,
    selectedRuntime,
    summary,
    effectiveGetModelDisabledReason,
    focusBoundary: (fromEnd: boolean) =>
      focusModel(findSelectableModelIndex(items, effectiveGetModelDisabledReason, fromEnd)),
    registerButton,
    onModelFocus,
    onModelBlur,
    onNavigate,
    onSelect,
    handleOpenChange,
    onRowsRendered,
    focusInitialPopoverControl,
    focusPopoverFallback,
    setSpeedFocusNode,
    selectView: (view: ModelPickerView) => {
      if (isSpeedOnly) return;
      setActiveView(view);
      setSearchQuery("");
      searchInputRef.current?.focus();
    },
  };
}

type ModelPickerController = ReturnType<typeof useModelPickerController>;

function ModelPickerPopoverPanel({
  ctrl,
  runtimes,
  value,
  favoriteState,
  selectionPolicy,
  options,
}: {
  ctrl: ModelPickerController;
  runtimes: readonly ModelPickerRuntime[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  selectionPolicy: ModelPickerSelectionPolicy;
  options: ModelPickerOptionsPaneModel;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[3.5rem_minmax(0,1fr)]">
        <ModelPickerRail
          runtimes={runtimes}
          activeView={ctrl.activeView}
          selectionPolicy={selectionPolicy}
          onSelectView={ctrl.selectView}
        />
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="shrink-0 border-b border-border p-2">
            <div className="relative flex items-center">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
              />
              <Input
                ref={ctrl.searchInputRef}
                aria-label="Search models"
                placeholder={
                  selectionPolicy.kind === "speed_only"
                    ? selectionPolicy.reason
                    : "Search models..."
                }
                disabled={ctrl.isSpeedOnly}
                value={ctrl.searchQuery}
                onChange={(event) => ctrl.setSearchQuery(event.target.value)}
                className="pl-8"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    ctrl.focusBoundary(event.key === "ArrowUp");
                  }
                }}
              />
            </div>
          </div>
          <ModelPickerFavoriteNotice state={favoriteState} />
          <div className="flex min-h-0 max-h-80 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            <ModelPickerLoadingNotice runtimes={ctrl.visibleResources} />
            {ctrl.visibleResources.map((runtime) => (
              <ModelPickerResourceNotice key={runtime.descriptor.kind} runtime={runtime} />
            ))}
            <ModelPickerList
              items={ctrl.items}
              value={value}
              favoriteState={favoriteState}
              getModelDisabledReason={ctrl.effectiveGetModelDisabledReason}
              registerButton={ctrl.registerButton}
              onFocus={ctrl.onModelFocus}
              onBlur={ctrl.onModelBlur}
              onNavigate={ctrl.onNavigate}
              onSelect={ctrl.onSelect}
              activeView={ctrl.activeView}
              searchQuery={ctrl.searchQuery}
              emptyMessage={ctrl.emptyMessage}
              listRef={ctrl.listRef}
              onRowsRendered={ctrl.onRowsRendered}
            />
          </div>
        </div>
      </div>
      <ModelPickerOptionsPane
        selectedRuntime={ctrl.selectedRuntime}
        value={value}
        selectionPolicy={selectionPolicy}
        options={options}
      />
    </div>
  );
}

export function ModelPicker({
  shortcutId,
  runtimes,
  value,
  favoriteState,
  selectionPolicy,
  options,
  closedTriggerDisabledReason = null,
  onValueChange,
  getModelDisabledReason,
  placeholder = "Select a model",
  triggerVariant = "form",
  triggerClassName,
  triggerRef,
  popoverSide = "bottom",
  popoverAvoidCollisions = true,
  onOpenChange,
}: ModelPickerProps): ReactElement {
  const disabledReasonId = useId();
  const ctrl = useModelPickerController({
    runtimes,
    value,
    favoriteState,
    selectionPolicy,
    options,
    closedTriggerDisabledReason,
    onValueChange,
    getModelDisabledReason,
    placeholder,
    onOpenChange,
  });
  const focusBridge = useMemo(
    () => ({
      setSpeedFocusNode: ctrl.setSpeedFocusNode,
      onSpeedSectionHidden: ctrl.focusPopoverFallback,
    }),
    [ctrl.focusPopoverFallback, ctrl.setSpeedFocusNode],
  );

  return (
    <TooltipProvider>
      <Popover open={ctrl.effectiveOpen} onOpenChange={ctrl.handleOpenChange}>
        {ctrl.closedDisabledReason ? (
          <span id={disabledReasonId} className="sr-only">
            {ctrl.closedDisabledReason}
          </span>
        ) : null}
        <Tooltip open={ctrl.effectiveOpen || !ctrl.triggerBlocked ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <ModelPickerTrigger
                ref={triggerRef}
                summary={ctrl.summary}
                triggerVariant={triggerVariant}
                shortcutId={shortcutId}
                className={triggerClassName}
                disabledReason={ctrl.closedDisabledReason}
                disabledReasonId={disabledReasonId}
                isDisabled={ctrl.triggerBlocked}
              />
            </PopoverTrigger>
          </TooltipTrigger>
          {ctrl.triggerBlocked && ctrl.closedDisabledReason ? (
            <TooltipContent className="max-w-xs">{ctrl.closedDisabledReason}</TooltipContent>
          ) : null}
        </Tooltip>
        <PopoverContent
          ref={ctrl.popoverContentRef}
          portalContainer={ctrl.portalContainer}
          side={popoverSide}
          avoidCollisions={popoverAvoidCollisions}
          className="@container flex max-h-[var(--radix-popover-content-available-height)] w-[min(42rem,calc(100vw-2rem),var(--radix-popover-content-available-width))] flex-col overflow-hidden p-0"
          collisionPadding={8}
          onPointerDownOutside={(event) => {
            if (isNestedPopoverTarget(event.target)) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (isNestedPopoverTarget(event.target)) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            ctrl.focusInitialPopoverControl();
          }}
        >
          <ModelPickerFocusContext value={focusBridge}>
            <ModelPickerPopoverPanel
              ctrl={ctrl}
              runtimes={runtimes}
              value={value}
              favoriteState={favoriteState}
              selectionPolicy={selectionPolicy}
              options={options}
            />
          </ModelPickerFocusContext>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
