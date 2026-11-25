import type { AgentModelAttachmentSupport } from "@openducktor/core";
import { formatTokenCompact } from "@openducktor/frontend-core/lib/format-token-count";
import {
  isSameModelPickerValue,
  type ModelPickerFavoriteState,
  type ModelPickerItem,
  type ModelPickerRuntime,
  type ModelPickerValue,
  type ModelPickerView,
  modelPickerValueKey,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  MODEL_PICKER_CAPABILITIES,
  modelPickerFavoriteDisabledReason,
  modelPickerMetadataDescription,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import {
  Check,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One loader covers every runtime whose catalog has not loaded yet. */
export function ModelPickerLoadingNotice({
  runtimes,
}: {
  runtimes: readonly ModelPickerRuntime[];
}): ReactElement | null {
  const [first, ...others] = runtimes.filter((runtime) => runtime.resource.status === "loading");
  if (!first) {
    return null;
  }
  const subject = others.length === 0 ? `${first.descriptor.label} models` : "models";
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground" role="status">
      <LoaderCircle className="animate-spin" aria-hidden="true" />
      Loading {subject}…
    </div>
  );
}

export function ModelPickerResourceNotice({
  runtime,
}: {
  runtime: ModelPickerRuntime;
}): ReactElement | null {
  const { resource } = runtime;
  if (resource.status === "loading" || resource.status === "ready") {
    return null;
  }
  if (resource.status === "unavailable") {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground" role="status">
        {runtime.descriptor.label}: {resource.reason}
      </div>
    );
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
}

export function ModelPickerFavoriteNotice({
  state,
}: {
  state: ModelPickerFavoriteState;
}): ReactElement | null {
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
}

const MODEL_CAPABILITY_ICONS = {
  image: ImageIcon,
  video: Film,
  audio: FileAudio2,
  pdf: FileText,
} as const;

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
  const capabilities = MODEL_PICKER_CAPABILITIES.filter((capability) => support[capability.key]);
  if (capabilities.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {capabilities.map(({ key, label, description }) => {
        const Icon = MODEL_CAPABILITY_ICONS[key];
        return (
          <Tooltip key={label} disableHoverableContent>
            <TooltipTrigger asChild>
              <span role="img" aria-label={label}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{description}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
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
  onSelect: (close: boolean, skipEmit?: boolean) => void;
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
  const metadataDescription = modelPickerMetadataDescription(item);
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
      data-model-select=""
      className="min-h-11 min-w-0 flex-1 justify-start rounded-lg px-2.5 py-1.5 font-normal hover:bg-transparent focus-visible:ring-0"
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          onNavigate(event.key);
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect(false);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onSelect(true);
        }
      }}
      onClick={(event) => {
        if (event.detail <= 1) {
          onSelect(false);
        }
      }}
      onDoubleClick={(event) => onSelect(true, event.detail >= 2)}
    >
      <AgentRuntimeIcon runtimeKind={item.runtime.kind} />
      <span className="flex min-w-0 flex-1 flex-col items-start overflow-hidden text-left">
        <span
          className={cn(
            "w-full truncate text-[13px] leading-tight text-foreground",
            selected ? "font-semibold" : "font-medium",
          )}
        >
          {item.model.modelName}
        </span>
        <span className="w-full truncate text-[11.5px] leading-tight text-muted-foreground">
          {item.model.providerName} · {item.model.modelId}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 self-center text-[11px] text-muted-foreground">
        <ModelCapabilityIcons support={item.model.attachmentSupport} />
        {contextWindowLabel ? <span className="shrink-0">{contextWindowLabel} context</span> : null}
        {selected ? (
          <Check
            aria-hidden="true"
            data-selected-indicator=""
            className="ml-0.5 size-3.5 shrink-0 text-primary"
          />
        ) : null}
      </span>
    </Button>
  );
};

const ModelFavoriteButton = ({
  item,
  favoriteState,
}: Pick<ModelRowProps, "item" | "favoriteState">): ReactElement => {
  const favoriteDisabledReasonId = useId();
  const favoriteDisabledReason = modelPickerFavoriteDisabledReason(favoriteState);
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
            className={cn(
              "mr-1 size-7 shrink-0",
              favoriteDisabledReason && "cursor-not-allowed opacity-50",
            )}
            aria-label={favoriteLabel}
            aria-pressed={item.isFavorite}
            aria-disabled={favoriteDisabledReason !== null}
            aria-describedby={favoriteDisabledReason ? favoriteDisabledReasonId : undefined}
            onClick={
              favoriteDisabledReason
                ? undefined
                : () => favoriteState.toggleFavorite(item.value, item.savedFavorites)
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
      className={cn("flex min-w-0", style && "px-1 pt-1")}
      style={style}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 rounded-lg border transition-colors has-[button[data-model-select]:focus-visible]:ring-2 has-[button[data-model-select]:focus-visible]:ring-inset has-[button[data-model-select]:focus-visible]:ring-ring",
          selected
            ? "border-primary/25 bg-primary/[0.07] hover:bg-primary/[0.1] dark:border-primary/35 dark:bg-primary/[0.14] dark:hover:bg-primary/[0.18]"
            : "border-transparent hover:bg-muted/70",
        )}
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
      </div>
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
  onSelect: (index: number, close: boolean, skipEmit?: boolean) => void;
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
      onSelect={(close, skipEmit) => onSelect(index, close, skipEmit)}
      style={style}
      ariaAttributes={ariaAttributes}
    />
  );
};

export function ModelPickerList({
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
}): ReactElement | null {
  const isVirtualized = items.length >= VIRTUALIZATION_MIN_MODEL_COUNT;
  const [rowHeight, setRowHeight] = useState(MODEL_ROW_HEIGHT_PX);
  const rowHeightProbeRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const probe = rowHeightProbeRef.current;
    if (!probe) {
      return;
    }
    const updateRowHeight = (): void => {
      const measuredHeight = probe.getBoundingClientRect().height;
      if (measuredHeight > 0) {
        setRowHeight(measuredHeight);
      }
    };
    updateRowHeight();
    const observer = new ResizeObserver(updateRowHeight);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [isVirtualized]);

  const virtualRowProps = useMemo<VirtualModelRowData>(
    () => ({
      items,
      value,
      favoriteState,
      getModelDisabledReason,
      registerButton,
      onFocus,
      onBlur,
      onNavigate,
      onSelect,
    }),
    [
      favoriteState,
      getModelDisabledReason,
      items,
      onBlur,
      onFocus,
      onNavigate,
      onSelect,
      registerButton,
      value,
    ],
  );

  if (isVirtualized) {
    return (
      <>
        <span
          ref={rowHeightProbeRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-[3.25rem] w-0"
        />
        <List
          key={`${activeView}:${searchQuery}`}
          tagName="ul"
          aria-label="Models"
          className="min-h-0 overflow-x-hidden"
          style={{
            height: Math.min(items.length * rowHeight + 4, MODEL_LIST_MAX_HEIGHT_PX),
          }}
          defaultHeight={MODEL_LIST_MAX_HEIGHT_PX}
          listRef={listRef}
          rowComponent={VirtualModelRow}
          rowCount={items.length}
          rowHeight={rowHeight}
          rowKey={modelRowKey}
          rowProps={virtualRowProps}
          onRowsRendered={(_visibleRows, allRows) => onRowsRendered(allRows)}
        />
      </>
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
              onSelect={(close, skipEmit) => onSelect(index, close, skipEmit)}
            />
          );
        })}
      </ul>
    );
  }

  return emptyMessage ? (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
  ) : null;
}
