import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelAttachmentSupport } from "@openducktor/core";
import {
  Check,
  ChevronsUpDown,
  FileAudio2,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Star,
} from "lucide-react";
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  value: ModelPickerValue | null,
  runtimes: readonly ModelPickerRuntime[],
  selectionPolicy: ModelPickerSelectionPolicy,
): ModelPickerView => {
  if (selectionPolicy.kind === "runtime_locked") {
    return selectionPolicy.runtimeKind;
  }
  return value?.runtimeKind ?? runtimes[0]?.descriptor.kind ?? "favorites";
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
  { key: "image", icon: ImageIcon, label: "Supports images" },
  { key: "video", icon: Film, label: "Supports videos" },
  { key: "audio", icon: FileAudio2, label: "Supports audio" },
  { key: "pdf", icon: FileText, label: "Supports PDF files" },
] as const;

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
      {capabilities.map(({ icon: Icon, label }) => (
        <span key={label} role="img" aria-label={label} title={label}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      ))}
    </span>
  );
};

const ModelRow = ({
  item,
  selected,
  favoriteState,
  disabledReason,
  buttonRef,
  onNavigate,
  onSelect,
}: {
  item: ModelPickerItem;
  selected: boolean;
  favoriteState: ModelPickerFavoriteState;
  disabledReason: string | null;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onNavigate: (key: "ArrowDown" | "ArrowUp" | "Home" | "End") => void;
  onSelect: () => void;
}): ReactElement => {
  const favoriteLabel = item.isFavorite
    ? `Remove ${item.model.modelName} from favorites`
    : `Add ${item.model.modelName} to favorites`;
  const favoriteTooltip = item.isFavorite ? "Remove from favorites" : "Add to favorites";
  const contextWindowLabel = formatTokenCompact(item.model.contextWindow);
  const favoriteDisabledReasonId = useId();
  const favoriteDisabledReason = (() => {
    if (favoriteState.canMutate) {
      return null;
    }
    if (favoriteState.readError) {
      return `Favorites unavailable: ${favoriteState.readError}`;
    }
    if (favoriteState.isLoading) {
      return "Favorites are loading.";
    }
    if (favoriteState.isMutationPending) {
      return "Saving favorite changes.";
    }
    return favoriteState.mutationError ?? "Favorites are unavailable.";
  })();
  return (
    <li
      aria-label={`${item.model.modelName} model actions`}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        disabled={disabledReason !== null}
        aria-label={`Select ${item.model.modelName} model`}
        aria-pressed={selected}
        aria-description={disabledReason ?? undefined}
        className={cn(
          "min-h-12 min-w-0 flex-1 justify-start rounded-r-none px-3 py-2 font-normal",
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
        <AgentRuntimeIcon runtimeKind={item.runtime.kind} />
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="truncate font-medium">{item.model.modelName}</span>
          <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">
              {item.model.providerName} · {item.model.modelId}
              {contextWindowLabel ? ` · ${contextWindowLabel} context` : ""}
            </span>
            <ModelCapabilityIcons support={item.model.attachmentSupport} />
          </span>
        </span>
        {selected ? <Check aria-label="Selected model" /> : null}
      </Button>
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
    </li>
  );
};

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
    activeViewFor(value, runtimes, selectionPolicy),
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const readOnlyReasonId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.descriptor.kind === value?.runtimeKind,
  );
  const selectedItem = runtimes
    .flatMap((runtime) =>
      (runtime.resource.catalog?.models ?? []).map((model) => ({ runtime, model })),
    )
    .find(
      ({ runtime, model }) =>
        runtime.descriptor.kind === value?.runtimeKind &&
        model.providerId === value?.providerId &&
        model.modelId === value?.modelId,
    );
  const triggerRuntime = selectedRuntime?.descriptor ?? null;
  const triggerModelLabel = selectedItem?.model.modelName ?? value?.modelId ?? placeholder;
  const triggerAriaLabel = triggerRuntime
    ? `Select model, ${triggerRuntime.label}, ${triggerModelLabel}`
    : `Select model, ${triggerModelLabel}`;
  const visibleResources = runtimes.filter((runtime) => {
    if (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind) {
      return false;
    }
    if (searchQuery.trim() || activeView === "favorites") {
      return true;
    }
    return runtime.descriptor.kind === activeView;
  });
  const activeRuntime = runtimes.find((runtime) => runtime.descriptor.kind === activeView) ?? null;
  const readOnlyReason = selectionPolicy.kind === "read_only" ? selectionPolicy.reason : null;

  const focusModelBoundary = (fromEnd: boolean): void => {
    const indexes = Array.from({ length: items.length }, (_, index) => index);
    if (fromEnd) {
      indexes.reverse();
    }
    const target = indexes
      .map((index) => modelButtonRefs.current[index])
      .find((button) => button && !button.disabled);
    target?.focus();
  };

  const focusAdjacentModel = (currentIndex: number, direction: 1 | -1): void => {
    for (let step = 1; step <= items.length; step += 1) {
      const targetIndex = (currentIndex + direction * step + items.length) % items.length;
      const target = modelButtonRefs.current[targetIndex];
      if (target && !target.disabled) {
        target.focus();
        return;
      }
    }
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (readOnlyReason) {
      return;
    }
    if (nextOpen) {
      setActiveView(activeViewFor(value, runtimes, selectionPolicy));
      const activeElement = document.activeElement;
      setPortalContainer(
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
          : null,
      );
    }
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const emptyMessage = (() => {
    if (runtimes.length === 0) {
      return "No agent runtimes are available.";
    }
    if (searchQuery.trim()) {
      return "No models match your search.";
    }
    if (activeView === "favorites") {
      if (favoriteState.isLoading) {
        return "Loading favorites...";
      }
      if (favoriteState.readError) {
        return "Favorites are unavailable until settings load succeeds.";
      }
      return "No favorite models are available here. Use a model row's star to add one.";
    }
    if (activeRuntime && activeRuntime.resource.status !== "ready") {
      return null;
    }
    return `No ${activeRuntime?.descriptor.label ?? "runtime"} models are available.`;
  })();

  let listContent: ReactElement | null = null;
  if (items.length > 0) {
    listContent = (
      <ul aria-label="Models" className="space-y-1 p-1">
        {items.map((item, index) => {
          const disabledReason = getModelDisabledReason?.(item) ?? null;
          return (
            <ModelRow
              key={modelPickerValueKey(item.value)}
              item={item}
              selected={isSameModelPickerValue(value, item.value)}
              favoriteState={favoriteState}
              disabledReason={disabledReason}
              buttonRef={(element) => {
                modelButtonRefs.current[index] = element;
              }}
              onNavigate={(key) => {
                if (key === "ArrowDown") {
                  focusAdjacentModel(index, 1);
                  return;
                }
                if (key === "ArrowUp") {
                  focusAdjacentModel(index, -1);
                  return;
                }
                focusModelBoundary(key === "End");
              }}
              onSelect={() => {
                if (disabledReason) {
                  return;
                }
                onValueChange(item.value);
                setSearchQuery("");
                setOpen(false);
                onOpenChange?.(false);
              }}
            />
          );
        })}
      </ul>
    );
  } else if (emptyMessage) {
    listContent = (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
    );
  }

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
          className="w-[min(42rem,calc(100vw-2rem))] overflow-hidden p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
        >
          <div className="grid min-h-72 grid-cols-[3.5rem_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-1 border-r border-border bg-muted/40 p-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={activeView === "favorites" ? "secondary" : "ghost"}
                    className={cn("size-9", activeView === "favorites" && "ring-1 ring-ring")}
                    aria-label="Favorite models"
                    aria-pressed={activeView === "favorites"}
                    onClick={() => {
                      setActiveView("favorites");
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
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
                    onSelect={() => {
                      setActiveView(runtime.descriptor.kind);
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                  />
                );
              })}
            </div>
            <div className="min-w-0">
              <div className="border-b border-border p-2">
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
              <div className="max-h-80 overflow-y-auto overflow-x-hidden">
                {visibleResources.map((runtime) => (
                  <ResourceNotice key={runtime.descriptor.kind} runtime={runtime} />
                ))}
                {listContent}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
