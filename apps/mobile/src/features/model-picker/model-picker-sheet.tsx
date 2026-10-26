import type { AgentModelFavorite } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type {
  ModelPickerRuntime,
  ModelPickerValue,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { FlashList } from "@shopify/flash-list";
import { type ReactElement, useCallback, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { Button } from "@/ui/button";
import { KEEP_TOP_VISIBLE } from "@/ui/list-position";
import { SearchField } from "@/ui/search-field";
import { EmptyState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import {
  type ModelPickerListRow,
  type ModelPickerLock,
  selectedModelRowIndex,
} from "./model-picker-rows";
import { ModelGroupHeader, ModelRow } from "./model-row";
import { RuntimeRail } from "./runtime-rail";
import { type ModelPicker, useModelPicker } from "./use-model-picker";
import { modelPickerFavoriteDisabledReason } from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import type { AgentModelFavoritesState } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import { useModelFavorites } from "./use-model-favorites";
import { useCommandGate } from "@/host-session/active-session-context";

const keyOf = (row: ModelPickerListRow): string => row.key;
const INITIAL_SCROLL = { viewOffset: -120 };
const typeOf = (row: ModelPickerListRow): string => row.type;

/** The catalog state of the runtimes that the list shows: one loader, then each failure. */
function CatalogNotices({ runtimes }: { runtimes: readonly ModelPickerRuntime[] }) {
  const theme = useAppTheme();
  const loading = runtimes.filter((runtime) => runtime.resource.status === "loading");
  const first = loading[0];
  const notices = runtimes.flatMap((runtime) => {
    const { resource } = runtime;
    const label = runtime.descriptor.label;
    if (resource.status === "unavailable") {
      return [
        <Callout
          key={label}
          tone="warning"
          title={`${label} models are not available`}
          message={resource.reason}
        />,
      ];
    }
    if (resource.status === "failed") {
      return [
        <Callout
          key={label}
          tone="destructive"
          title={`${label} models did not load`}
          message={resource.error}
          action={
            <Button
              label="Try Again"
              variant="gray"
              size="sm"
              onPress={() => void resource.retry()}
            />
          }
        />,
      ];
    }
    return [];
  });
  if (!first && notices.length === 0) return null;
  return (
    <View style={styles.notices}>
      {first ? (
        <View style={styles.loading} accessibilityRole="progressbar">
          <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
          <Text variant="callout" tone="tertiary">
            {loading.length === 1 ? `Loading ${first.descriptor.label} models…` : "Loading models…"}
          </Text>
        </View>
      ) : null}
      {notices}
    </View>
  );
}

/** A failed favorites read or save, with its retry, as the desktop picker shows it. */
function FavoriteNotice({ state }: { state: AgentModelFavoritesState }): ReactElement | null {
  if (state.readError) {
    return (
      <View style={styles.favoriteNotice}>
        <Callout
          tone="destructive"
          title="Favorites are not available"
          message={state.readError}
          action={<Button label="Try Again" variant="gray" size="sm" onPress={state.retryRead} />}
        />
      </View>
    );
  }
  if (!state.mutationError) return null;
  return (
    <View style={styles.favoriteNotice}>
      <Callout
        tone="destructive"
        title="The favorite was not saved"
        message={state.mutationError}
        action={
          <Button
            label="Try Again"
            variant="gray"
            size="sm"
            command
            disabled={state.isMutationPending}
            onPress={state.retryMutation}
          />
        }
      />
    </View>
  );
}

/** Why the list is empty, or null while a catalog loads or failed and its notice explains it. */
function emptyStateOf(
  picker: ModelPicker,
): { title: string; message: string; icon: "search-x" | "star" | "cpu" } | null {
  if (picker.searching) {
    return {
      title: "No Results",
      message: "No model matches. Try another search.",
      icon: "search-x",
    };
  }
  if (picker.view === "favorites") {
    return {
      title: "No Favorites",
      message: "No favorite model is available on this host.",
      icon: "star",
    };
  }
  const runtime = picker.shownRuntimes[0];
  if (!runtime || runtime.resource.status !== "ready") return null;
  return {
    title: "No Models",
    message: `The host lists no ${runtime.descriptor.label} models.`,
    icon: "cpu",
  };
}

function ModelPickerContent({
  runtimes,
  selection,
  favorites,
  lock,
  disabled,
  onChoose,
}: {
  runtimes: readonly ModelPickerRuntime[];
  selection: AgentModelSelection | null;
  favorites: readonly AgentModelFavorite[] | null;
  lock: ModelPickerLock | null;
  disabled: boolean;
  onChoose: (value: ModelPickerValue) => void;
}): ReactElement {
  const picker = useModelPicker({ runtimes, selection, favorites, lock });
  const { rows } = picker;
  const valuesByKey = useMemo(
    () => new Map(rows.flatMap((row) => (row.type === "model" ? [[row.key, row.item.value]] : []))),
    [rows],
  );
  const choose = useCallback(
    (key: string) => {
      const value = valuesByKey.get(key);
      if (value) onChoose(value);
    },
    [onChoose, valuesByKey],
  );
  // A star change is a host command, so it waits for a live host connection, as Send does.
  const favoriteState = useModelFavorites();
  const gate = useCommandGate();
  const favoriteDisabledReason = gate.open
    ? modelPickerFavoriteDisabledReason(favoriteState)
    : "Available when the host connection is live.";
  const { toggleFavorite } = favoriteState;
  const itemsByKey = useMemo(
    () => new Map(rows.flatMap((row) => (row.type === "model" ? [[row.key, row.item]] : []))),
    [rows],
  );
  const toggle = useCallback(
    (key: string) => {
      const item = itemsByKey.get(key);
      if (item) toggleFavorite(item.value, item.savedFavorites);
    },
    [itemsByKey, toggleFavorite],
  );
  const renderItem = useCallback(
    ({ item }: { item: ModelPickerListRow }) =>
      item.type === "header" ? (
        <ModelGroupHeader row={item} />
      ) : (
        <ModelRow
          row={item}
          disabled={disabled}
          favoriteDisabledReason={favoriteDisabledReason}
          onSelect={choose}
          onToggleFavorite={toggle}
        />
      ),
    [choose, disabled, favoriteDisabledReason, toggle],
  );
  // A browsed list opens at the selected model, with the rows above it in view.
  const initialIndex = useMemo(
    () => (picker.searching ? null : selectedModelRowIndex(rows)),
    [picker.searching, rows],
  );
  const loading = picker.shownRuntimes.some((runtime) => runtime.resource.status === "loading");
  const empty = loading ? null : emptyStateOf(picker);
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        {picker.tabs.length > 0 ? (
          <RuntimeRail tabs={picker.tabs} view={picker.view} onSelect={picker.setView} />
        ) : null}
        <View style={styles.search}>
          <SearchField
            value={picker.query}
            onChangeText={picker.setQuery}
            placeholder="Search models"
            accessibilityLabel="Search models"
            editable={!disabled}
          />
        </View>
      </View>
      <FavoriteNotice state={favoriteState} />
      <View style={styles.list}>
        <FlashList
          // A new view or search starts at the top of its own list.
          key={`${picker.view}:${picker.searching ? "search" : "browse"}`}
          data={rows}
          keyExtractor={keyOf}
          getItemType={typeOf}
          renderItem={renderItem}
          initialScrollIndex={initialIndex !== null && initialIndex > 4 ? initialIndex : null}
          initialScrollIndexParams={INITIAL_SCROLL}
          maintainVisibleContentPosition={KEEP_TOP_VISIBLE}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={<CatalogNotices runtimes={picker.shownRuntimes} />}
          ListEmptyComponent={
            empty ? (
              <EmptyState icon={empty.icon} title={empty.title} message={empty.message} />
            ) : null
          }
        />
      </View>
    </View>
  );
}

/**
 * The model picker, as the desktop popover adapted to a sheet: the runtime switch with the brand
 * marks, a search field, and the models grouped by provider, with the favorites first. A star
 * adds or removes a favorite. A choice closes the sheet.
 */
export function ModelPickerSheet({
  visible,
  runtimes,
  selection,
  favorites = null,
  lock = null,
  disabled = false,
  onChoose,
  onClose,
}: {
  visible: boolean;
  /** One runtime shows its models without a choice of runtime. */
  runtimes: readonly ModelPickerRuntime[];
  selection: AgentModelSelection | null;
  /** The favorite models of the host. The star of a row adds or removes one. */
  favorites?: readonly AgentModelFavorite[] | null | undefined;
  /** The runtime that the choice must keep, such as the runtime of an existing session. */
  lock?: ModelPickerLock | null | undefined;
  /** True while a choice cannot apply, such as while the host connection is down. */
  disabled?: boolean | undefined;
  onChoose: (value: ModelPickerValue) => void;
  onClose: () => void;
}): ReactElement {
  const choose = useCallback(
    (value: ModelPickerValue) => {
      onChoose(value);
      onClose();
    },
    [onChoose, onClose],
  );
  return (
    <InPlaceSheet
      visible={visible}
      title="Model"
      onClose={onClose}
      scrolls={false}
      padded={false}
      background="surface"
    >
      {runtimes.length === 0 ? (
        <EmptyState
          icon="cpu"
          title="No Runtime"
          message="No runtime is available on the host. Start one there, then try again."
        />
      ) : (
        // The modal unmounts its content after it closes, so search and runtime start fresh on each
        // open. iOS keeps the content while the sheet slides away.
        <ModelPickerContent
          runtimes={runtimes}
          selection={selection}
          favorites={favorites}
          lock={lock}
          disabled={disabled}
          onChoose={choose}
        />
      )}
    </InPlaceSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  toolbar: {
    gap: theme.space.md,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.md,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.desktop.popover,
  },
  search: { paddingHorizontal: theme.layout.screenPadding },
  notices: { gap: theme.space.sm, padding: theme.layout.screenPadding, paddingBottom: 0 },
  favoriteNotice: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.sm,
    backgroundColor: theme.desktop.popover,
  },
  loading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 32 },
  list: { flex: 1, backgroundColor: theme.desktop.popover },
  listContent: { paddingBottom: theme.space.xxxl },
}));
