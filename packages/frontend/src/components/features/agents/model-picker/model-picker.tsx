import { resolveModelPickerPresentation } from "./model-picker-presentation";
import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelAttachmentSupport } from "@openducktor/core";
import {
  ChevronsUpDown,
  FileAudio2,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Star,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatTokenCompact } from "../format-token-count";
import {
  buildModelPickerItems,
  isSameModelPickerValue,
  type ModelPickerItem,
  type ModelPickerRuntime,
  type ModelPickerValue,
  type ModelPickerView,
  modelPickerValueKey,
} from "./model-picker-model";

export type ModelPickerFavoriteState = {
  favorites: AgentModelFavorite[] | null;
  isLoading: boolean;
  readError: string | null;
  isMutationPending: boolean;
  mutationError: string | null;
  canMutate: boolean;
  toggleFavorite: (favorite: AgentModelFavorite) => void;
  retryRead: () => void;
  retryMutation: () => void;
};

export type ModelPickerSelectionPolicy =
  | { kind: "editable" }
  | { kind: "runtime_locked"; runtimeKind: RuntimeKind; reason: string }
  | { kind: "read_only"; reason: string };

type ModelPickerProps = {
  runtimes: readonly ModelPickerRuntime[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  selectionPolicy: ModelPickerSelectionPolicy;
  onValueChange: (value: ModelPickerValue) => void;
  getModelDisabledReason?: (item: ModelPickerItem) => string | null;
  triggerClassName?: string;
  placeholder?: string;
  onOpenChange?: (open: boolean) => void;
};

const activeViewFor = (
  runtimes: readonly ModelPickerRuntime[],
  favorites: readonly AgentModelFavorite[] | null,
  selectionPolicy: ModelPickerSelectionPolicy,
): ModelPickerView => {
  const availableFavorites = favorites?.filter((favorite) =>
    runtimes.some(
      (runtime) =>
        runtime.isEnabledForFavorites && runtime.descriptor.kind === favorite.runtimeKind,
    ),
  );
  if (selectionPolicy.kind === "runtime_locked") {
    if (
      availableFavorites?.some((favorite) => favorite.runtimeKind === selectionPolicy.runtimeKind)
    ) {
      return "favorites";
    }
    return selectionPolicy.runtimeKind;
  }
  if (availableFavorites?.length) {
    return "favorites";
  }
  return (
    runtimes.find((runtime) => runtime.isEnabledForFavorites)?.descriptor.kind ??
    runtimes[0]?.descriptor.kind ??
    "favorites"
  );
};

const ResourceNotice = ({ runtime }: { runtime: ModelPickerRuntime }): ReactElement | null => {
  const { resource } = runtime;
  if (resource.status === "loading" || resource.status === "refreshing") {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="animate-spin" aria-hidden="true" />
        {resource.status === "refreshing" ? "Refreshing" : "Loading"} {runtime.descriptor.label}{" "}
        models...
      </div>
    );
  }
  if (resource.status === "unavailable") {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground" role="status">
        {runtime.descriptor.label}: {resource.reason}
      </div>
    );
  }
  if (resource.status === "ready") {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" role="alert">
      <span className="min-w-0 text-destructive">
        {runtime.descriptor.label}: {resource.error}
      </span>
      <Button type="button" variant="outline" size="xs" onClick={() => void resource.retry()}>
        Retry
      </Button>
    </div>
  );
};

const FavoriteNotice = ({ state }: { state: ModelPickerFavoriteState }): ReactElement | null => {
  if (state.readError) {
    return (
      <div
        className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm"
        role="alert"
      >
        <span className="min-w-0 text-destructive">Favorites unavailable: {state.readError}</span>
        <Button type="button" variant="outline" size="xs" onClick={state.retryRead}>
          Retry
        </Button>
      </div>
    );
  }
  if (!state.mutationError) {
    return null;
  }
  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm"
      role="alert"
    >
      <span className="min-w-0 text-destructive">{state.mutationError}</span>
      <Button type="button" variant="outline" size="xs" onClick={state.retryMutation}>
        Retry
      </Button>
    </div>
  );
};

const RuntimeRailButton = ({
  runtime,
  active,
  disabledReason,
  onSelect,
}: {
  runtime: ModelPickerRuntime;
  active: boolean;
  disabledReason: string | null;
  onSelect: () => void;
}): ReactElement => {
  const disabledReasonId = useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={active ? "secondary" : "ghost"}
          className={cn(
            "size-9",
            active && "ring-1 ring-ring",
            disabledReason && "cursor-not-allowed opacity-50",
          )}
          aria-label={`${runtime.descriptor.label} runtime`}
          aria-pressed={active}
          aria-disabled={disabledReason !== null}
          aria-describedby={disabledReason ? disabledReasonId : undefined}
          onClick={disabledReason ? undefined : onSelect}
        >
          <AgentRuntimeIcon runtimeKind={runtime.descriptor.kind} />
        </Button>
      </TooltipTrigger>
      {disabledReason ? (
        <span id={disabledReasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
      <TooltipContent side="right">
        {disabledReason
          ? `${runtime.descriptor.label}: ${disabledReason}`
          : runtime.descriptor.label}
      </TooltipContent>
    </Tooltip>
  );
};

const MODEL_CAPABILITY_ICONS = [
  {
    key: "image",
    icon: ImageIcon,
    label: "Supports images",
    description: "Accepts image attachments like screenshots and diagrams",
  },
  {
    key: "video",
    icon: Film,
    label: "Supports videos",
    description: "Accepts video attachments",
  },
  {
    key: "audio",
    icon: FileAudio2,
    label: "Supports audio",
    description: "Accepts audio attachments",
  },
  {
    key: "pdf",
    icon: FileText,
    label: "Supports PDF files",
    description: "Accepts PDF documents as attachments",
  },
] as const;

const VIRTUALIZATION_MIN_MODEL_COUNT = 30;
const MODEL_ROW_HEIGHT_PX = 52;
const MODEL_LIST_MAX_HEIGHT_PX = 320;

const ModelCapabilityIcons = ({
  support,
}: {
  support: AgentModelAttachmentSupport | undefined;
}): ReactElement | null => {
  if (!support) {
    return null;
  }
  const capabilities = MODEL_CAPABILITY_ICONS.filter((capability) => support[capability.key]);
  if (capabilities.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {capabilities.map(({ icon: Icon, label, description }) => (
        <Tooltip key={label} disableHoverableContent>
          <TooltipTrigger asChild>
            <span role="img" aria-label={label}>
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{description}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
};

const modelMetadataDescription = (item: ModelPickerItem): string | null => {
  const contextWindowLabel = formatTokenCompact(item.model.contextWindow);
  const supportedCapabilities = MODEL_CAPABILITY_ICONS.filter(
    (capability) => item.model.attachmentSupport?.[capability.key],
  ).map((capability) => capability.label.replace("Supports ", "").toLowerCase());
  const parts: string[] = [];
  if (contextWindowLabel) {
    parts.push(`${contextWindowLabel} token context window`);
  }
  if (supportedCapabilities.length > 0) {
    parts.push(`Supports ${supportedCapabilities.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(". ") : null;
};

type ModelRowProps = {
  item: ModelPickerItem;
  selected: boolean;
  favoriteState: ModelPickerFavoriteState;
  disabledReason: string | null;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onBlur: (relatedTarget: EventTarget | null) => void;
  onNavigate: (key: "ArrowDown" | "ArrowUp" | "Home" | "End") => void;
  onSelect: () => void;
  style?: CSSProperties;
  ariaAttributes?: RowComponentProps["ariaAttributes"];
};

const ModelSelectionButton = ({
  item,
  selected,
  disabledReason,
  buttonRef,
  onNavigate,
  onSelect,
}: Pick<
  ModelRowProps,
  "item" | "selected" | "disabledReason" | "buttonRef" | "onNavigate" | "onSelect"
>): ReactElement => {
  const contextWindowLabel = formatTokenCompact(item.model.contextWindow);
  const metadataDescription = modelMetadataDescription(item);
  const selectionDescription = [metadataDescription, disabledReason].filter(Boolean).join(". ");
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      disabled={disabledReason !== null}
      aria-label={`Select ${item.model.modelName} model`}
      aria-pressed={selected}
      aria-description={selectionDescription || undefined}
      className={cn(
        "relative min-h-12 min-w-0 flex-1 justify-start rounded-r-none px-3 py-2 font-normal",
        selected && "bg-accent text-accent-foreground",
      )}
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          onNavigate(event.key);
        }
      }}
      onClick={onSelect}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        />
      ) : null}
      <AgentRuntimeIcon runtimeKind={item.runtime.kind} />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate font-medium">{item.model.modelName}</span>
        <span
          className={cn(
            "truncate text-xs",
            selected ? "text-accent-foreground" : "text-muted-foreground",
          )}
        >
          {item.model.providerName} · {item.model.modelId}
        </span>
      </span>
      <span
        className={cn(
          "ml-auto flex shrink-0 items-center gap-2 self-center text-xs",
          selected ? "text-accent-foreground" : "text-muted-foreground",
        )}
      >
        <ModelCapabilityIcons support={item.model.attachmentSupport} />
        {contextWindowLabel ? <span className="shrink-0">{contextWindowLabel} context</span> : null}
      </span>
    </Button>
  );
};

const favoriteDisabledReasonFor = (state: ModelPickerFavoriteState): string | null => {
  if (state.canMutate) {
    return null;
  }
  if (state.readError) {
    return `Favorites unavailable: ${state.readError}`;
  }
  if (state.isLoading) {
    return "Favorites are loading.";
  }
  if (state.isMutationPending) {
    return "Saving favorite changes.";
  }
  return state.mutationError ?? "Favorites are unavailable.";
};

const ModelFavoriteButton = ({
  item,
  favoriteState,
}: Pick<ModelRowProps, "item" | "favoriteState">): ReactElement => {
  const favoriteDisabledReasonId = useId();
  const favoriteDisabledReason = favoriteDisabledReasonFor(favoriteState);
  const favoriteLabel = item.isFavorite
    ? `Remove ${item.model.modelName} from favorites`
    : `Add ${item.model.modelName} to favorites`;
  const favoriteTooltip = item.isFavorite ? "Remove from favorites" : "Add to favorites";
  return (
    <>
      {favoriteDisabledReason ? (
        <span id={favoriteDisabledReasonId} className="sr-only">
          {favoriteDisabledReason}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("size-7", favoriteDisabledReason && "cursor-not-allowed opacity-50")}
            aria-label={favoriteLabel}
            aria-pressed={item.isFavorite}
            aria-disabled={favoriteDisabledReason !== null}
            aria-describedby={favoriteDisabledReason ? favoriteDisabledReasonId : undefined}
            onClick={
              favoriteDisabledReason ? undefined : () => favoriteState.toggleFavorite(item.value)
            }
          >
            <Star
              aria-hidden="true"
              className={cn(item.isFavorite && "fill-current text-amber-400")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{favoriteDisabledReason ?? favoriteTooltip}</TooltipContent>
      </Tooltip>
    </>
  );
};

const ModelRow = ({
  item,
  selected,
  favoriteState,
  disabledReason,
  buttonRef,
  onFocus,
  onBlur,
  onNavigate,
  onSelect,
  style,
  ariaAttributes,
}: ModelRowProps): ReactElement => {
  return (
    <li
      {...ariaAttributes}
      aria-label={`${item.model.modelName} model actions`}
      onFocus={onFocus}
      onBlur={(event) => onBlur(event.relatedTarget)}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md",
        style && "px-1 pt-1",
        selected && "bg-accent text-accent-foreground",
      )}
      style={style}
    >
      <ModelSelectionButton
        item={item}
        selected={selected}
        disabledReason={disabledReason}
        buttonRef={buttonRef}
        onNavigate={onNavigate}
        onSelect={onSelect}
      />
      <ModelFavoriteButton item={item} favoriteState={favoriteState} />
    </li>
  );
};

type VirtualModelRowData = {
  items: ModelPickerItem[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  getModelDisabledReason: ((item: ModelPickerItem) => string | null) | undefined;
  registerButton: (index: number, element: HTMLButtonElement | null) => void;
  onFocus: (modelKey: string) => void;
  onBlur: (modelKey: string, relatedTarget: EventTarget | null) => void;
  onNavigate: (index: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End") => void;
  onSelect: (index: number) => void;
};

const modelRowKey = (index: number, data: VirtualModelRowData): string =>
  modelPickerValueKey(data.items[index]!.value);

const VirtualModelRow = ({
  index,
  style,
  ariaAttributes,
  items,
  value,
  favoriteState,
  getModelDisabledReason,
  registerButton,
  onFocus,
  onBlur,
  onNavigate,
  onSelect,
}: RowComponentProps<VirtualModelRowData>): ReactElement => {
  const item = items[index]!;
  const modelKey = modelPickerValueKey(item.value);
  return (
    <ModelRow
      item={item}
      selected={isSameModelPickerValue(value, item.value)}
      favoriteState={favoriteState}
      disabledReason={getModelDisabledReason?.(item) ?? null}
      buttonRef={(element) => registerButton(index, element)}
      onFocus={() => onFocus(modelKey)}
      onBlur={(relatedTarget) => onBlur(modelKey, relatedTarget)}
      onNavigate={(key) => onNavigate(index, key)}
      onSelect={() => onSelect(index)}
      style={style}
      ariaAttributes={ariaAttributes}
    />
  );
};

const ModelPickerList = ({
  items,
  value,
  favoriteState,
  getModelDisabledReason,
  registerButton,
  onFocus,
  onBlur,
  onNavigate,
  onSelect,
  activeView,
  searchQuery,
  emptyMessage,
  listRef,
  onRowsRendered,
}: VirtualModelRowData & {
  activeView: ModelPickerView;
  searchQuery: string;
  emptyMessage: string | null;
  listRef: RefObject<ListImperativeAPI | null>;
  onRowsRendered: (range: { startIndex: number; stopIndex: number }) => void;
}): ReactElement | null => {
  if (items.length >= VIRTUALIZATION_MIN_MODEL_COUNT) {
    return (
      <List
        key={`${activeView}:${searchQuery}`}
        tagName="ul"
        aria-label="Models"
        className="min-h-0 overflow-x-hidden"
        style={{
          height: Math.min(items.length * MODEL_ROW_HEIGHT_PX + 4, MODEL_LIST_MAX_HEIGHT_PX),
        }}
        defaultHeight={MODEL_LIST_MAX_HEIGHT_PX}
        listRef={listRef}
        rowComponent={VirtualModelRow}
        rowCount={items.length}
        rowHeight={MODEL_ROW_HEIGHT_PX}
        rowKey={modelRowKey}
        rowProps={{
          items,
          value,
          favoriteState,
          getModelDisabledReason,
          registerButton,
          onFocus,
          onBlur,
          onNavigate,
          onSelect,
        }}
        onRowsRendered={(_visibleRows, allRows) => onRowsRendered(allRows)}
      />
    );
  }

  if (items.length > 0) {
    return (
      <ul aria-label="Models" className="space-y-1 p-1">
        {items.map((item, index) => {
          const modelKey = modelPickerValueKey(item.value);
          return (
            <ModelRow
              key={modelKey}
              item={item}
              selected={isSameModelPickerValue(value, item.value)}
              favoriteState={favoriteState}
              disabledReason={getModelDisabledReason?.(item) ?? null}
              buttonRef={(element) => registerButton(index, element)}
              onFocus={() => onFocus(modelKey)}
              onBlur={(relatedTarget) => onBlur(modelKey, relatedTarget)}
              onNavigate={(key) => onNavigate(index, key)}
              onSelect={() => onSelect(index)}
            />
          );
        })}
      </ul>
    );
  }

  return emptyMessage ? (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
  ) : null;
};

const ModelPickerRail = ({
  runtimes,
  activeView,
  selectionPolicy,
  onSelectView,
}: {
  runtimes: readonly ModelPickerRuntime[];
  activeView: ModelPickerView;
  selectionPolicy: ModelPickerSelectionPolicy;
  onSelectView: (view: ModelPickerView) => void;
}): ReactElement => (
  <div className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-muted/40 p-2">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={activeView === "favorites" ? "secondary" : "ghost"}
          className={cn("size-9", activeView === "favorites" && "ring-1 ring-ring")}
          aria-label="Favorite models"
          aria-pressed={activeView === "favorites"}
          onClick={() => onSelectView("favorites")}
        >
          <Star aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Favorites</TooltipContent>
    </Tooltip>
    {runtimes.map((runtime) => {
      const policyDisabledReason =
        selectionPolicy.kind === "runtime_locked" &&
        runtime.descriptor.kind !== selectionPolicy.runtimeKind
          ? selectionPolicy.reason
          : null;
      return (
        <RuntimeRailButton
          key={runtime.descriptor.kind}
          runtime={runtime}
          active={activeView === runtime.descriptor.kind}
          disabledReason={runtime.disabledReason ?? policyDisabledReason}
          onSelect={() => onSelectView(runtime.descriptor.kind)}
        />
      );
    })}
  </div>
);

export function ModelPicker({
  runtimes,
  value,
  favoriteState,
  selectionPolicy,
  onValueChange,
  getModelDisabledReason,
  triggerClassName,
  placeholder = "Select a model",
  onOpenChange,
}: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<ModelPickerView>(() =>
    activeViewFor(runtimes, favoriteState.favorites, selectionPolicy),
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const readOnlyReasonId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const focusedModelKey = useRef<string | null>(null);
  const lockedRuntimeKind =
    selectionPolicy.kind === "runtime_locked" ? selectionPolicy.runtimeKind : null;
  const items = useMemo(
    () =>
      buildModelPickerItems({
        runtimes,
        favorites: favoriteState.favorites,
        activeView,
        searchQuery,
        lockedRuntimeKind,
      }),
    [activeView, favoriteState.favorites, lockedRuntimeKind, runtimes, searchQuery],
  );
  useLayoutEffect(() => {
    const focusedKey = focusedModelKey.current;
    if (!open || focusedKey === null || document.activeElement !== document.body) {
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
  }, [items, open]);
  const { triggerRuntime, triggerModelLabel, triggerAriaLabel, visibleResources, emptyMessage } =
    resolveModelPickerPresentation({
      runtimes,
      value,
      placeholder,
      activeView,
      searchQuery,
      favoriteState,
      lockedRuntimeKind,
    });
  const readOnlyReason = selectionPolicy.kind === "read_only" ? selectionPolicy.reason : null;

  const registerButton = (index: number, element: HTMLButtonElement | null): void => {
    modelButtonRefs.current[index] = element;
  };

  const focusModel = (index: number): void => {
    const button = modelButtonRefs.current[index];
    if (button) {
      button.focus();
      return;
    }
    if (!listRef.current) {
      throw new Error("Model list is unavailable for keyboard navigation.");
    }
    pendingFocusIndex.current = index;
    listRef.current.scrollToRow({ index, align: "auto" });
  };

  const focusModelBoundary = (fromEnd: boolean): void => {
    for (let step = 0; step < items.length; step += 1) {
      const index = fromEnd ? items.length - 1 - step : step;
      if (!getModelDisabledReason?.(items[index]!)) {
        focusModel(index);
        return;
      }
    }
  };

  const focusAdjacentModel = (currentIndex: number, direction: 1 | -1): void => {
    for (let step = 1; step <= items.length; step += 1) {
      const targetIndex = (currentIndex + direction * step + items.length) % items.length;
      if (!getModelDisabledReason?.(items[targetIndex]!)) {
        focusModel(targetIndex);
        return;
      }
    }
  };

  const onNavigate = (index: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): void => {
    if (key === "ArrowDown" || key === "ArrowUp") {
      focusAdjacentModel(index, key === "ArrowDown" ? 1 : -1);
      return;
    }
    focusModelBoundary(key === "End");
  };

  const onSelect = (index: number): void => {
    const item = items[index]!;
    if (getModelDisabledReason?.(item)) {
      return;
    }
    onValueChange(item.value);
    pendingFocusIndex.current = null;
    focusedModelKey.current = null;
    setSearchQuery("");
    setOpen(false);
    onOpenChange?.(false);
  };

  const onModelBlur = (modelKey: string, relatedTarget: EventTarget | null): void => {
    if (relatedTarget && relatedTarget !== document.body && focusedModelKey.current === modelKey) {
      focusedModelKey.current = null;
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (readOnlyReason) {
      return;
    }
    if (nextOpen) {
      setActiveView(activeViewFor(runtimes, favoriteState.favorites, selectionPolicy));
      const activeElement = document.activeElement;
      setPortalContainer(
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
          : null,
      );
    }
    if (!nextOpen) {
      pendingFocusIndex.current = null;
      focusedModelKey.current = null;
    }
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const onRowsRendered = (allRows: { startIndex: number; stopIndex: number }): void => {
    const pendingIndex = pendingFocusIndex.current;
    if (pendingIndex !== null) {
      const target = modelButtonRefs.current[pendingIndex];
      if (target) {
        pendingFocusIndex.current = null;
        target.focus();
        return;
      }
    }
    const focusedKey = focusedModelKey.current;
    if (focusedKey === null || document.activeElement !== document.body) {
      return;
    }
    const focusedIndex = items.findIndex((item) => modelPickerValueKey(item.value) === focusedKey);
    if (focusedIndex < allRows.startIndex || focusedIndex > allRows.stopIndex) {
      focusedModelKey.current = null;
      searchInputRef.current?.focus();
    }
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      aria-label={triggerAriaLabel}
      aria-disabled={readOnlyReason !== null}
      aria-describedby={readOnlyReason ? readOnlyReasonId : undefined}
      onClick={readOnlyReason ? (event) => event.preventDefault() : undefined}
      className={cn(
        "h-9 w-full min-w-0 justify-between border-input bg-card px-3 font-normal",
        readOnlyReason && "cursor-not-allowed opacity-50",
        triggerClassName,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {triggerRuntime ? <AgentRuntimeIcon runtimeKind={triggerRuntime.kind} /> : null}
        <span className="truncate">{triggerModelLabel}</span>
      </span>
      <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
    </Button>
  );

  const selectView = (view: ModelPickerView): void => {
    setActiveView(view);
    setSearchQuery("");
    searchInputRef.current?.focus();
  };

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {readOnlyReason ? (
          <>
            <span id={readOnlyReasonId} className="sr-only">
              {readOnlyReason}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent>{readOnlyReason}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        )}
        <PopoverContent
          portalContainer={portalContainer}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
        >
          <div className="grid min-h-0 grid-cols-[3.5rem_minmax(0,1fr)]">
            <ModelPickerRail
              runtimes={runtimes}
              activeView={activeView}
              selectionPolicy={selectionPolicy}
              onSelectView={selectView}
            />
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="shrink-0 border-b border-border p-2">
                <Input
                  ref={searchInputRef}
                  aria-label="Search models"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      focusModelBoundary(event.key === "ArrowUp");
                    }
                  }}
                />
              </div>
              <FavoriteNotice state={favoriteState} />
              <div className="flex min-h-0 max-h-80 flex-col overflow-y-auto overflow-x-hidden">
                {visibleResources.map((runtime) => (
                  <ResourceNotice key={runtime.descriptor.kind} runtime={runtime} />
                ))}
                <ModelPickerList
                  items={items}
                  value={value}
                  favoriteState={favoriteState}
                  getModelDisabledReason={getModelDisabledReason}
                  registerButton={registerButton}
                  onFocus={(modelKey) => {
                    focusedModelKey.current = modelKey;
                  }}
                  onBlur={onModelBlur}
                  onNavigate={onNavigate}
                  onSelect={onSelect}
                  activeView={activeView}
                  searchQuery={searchQuery}
                  emptyMessage={emptyMessage}
                  listRef={listRef}
                  onRowsRendered={onRowsRendered}
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
