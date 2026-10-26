import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { FlashList } from "@shopify/flash-list";
import {
  type ComponentRef,
  type ReactElement,
  type Ref,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { type TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { focusWithKeyboard } from "./focus-with-keyboard";
import { InPlaceSheet } from "./in-place-sheet";
import type { IconName } from "./icon";
import { SearchField } from "./search-field";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { Text } from "./text";
import { type OptionChoice, type OptionPickerRow, optionPickerRows } from "./option-picker-model";
import { PickerRow } from "./picker-row";

const keyOf = (row: OptionPickerRow): string => row.value;

export type OptionPickerSheetProps = {
  visible: boolean;
  title: string;
  searchPlaceholder: string;
  /** A short note under the search field, such as a rule for the choice. */
  hint?: string | null | undefined;
  /** The options, or undefined until the read answers. */
  choices: readonly OptionChoice[] | undefined;
  /** The failure of the read. */
  error?: Error | null | undefined;
  /** The title of a failed read, such as "Branches did not load". */
  errorTitle?: string | undefined;
  /** The progress label while the read runs, such as "Loading branches". */
  loadingLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
  selected: string | null | undefined;
  emptyMessage: string;
  /** The icon of the empty list. */
  emptyIcon?: IconName | undefined;
  /** Branch names use the code font. */
  mono?: boolean | undefined;
  /** Opens the keyboard with the sheet, for a long list that the user searches first. */
  autoFocus?: boolean | undefined;
  onSelect: (value: string) => void;
  onClose: () => void;
};

function OptionList({
  choices,
  selected,
  hint,
  searchPlaceholder,
  emptyMessage,
  emptyIcon,
  mono,
  autoFocus,
  searchRef,
  onChoose,
}: Omit<
  OptionPickerSheetProps,
  "visible" | "title" | "error" | "errorTitle" | "loadingLabel" | "onRetry" | "onSelect" | "onClose"
> & {
  choices: readonly OptionChoice[];
  searchRef: Ref<ComponentRef<typeof TextInput>>;
  onChoose: (value: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  // FlashList changes its state during render, so its rows must not come from a deferred render.
  const rows = useMemo(
    () => optionPickerRows(choices, selected, query),
    [choices, query, selected],
  );
  const renderItem = useCallback(
    ({ item }: { item: OptionPickerRow }) => (
      <PickerRow
        id={item.value}
        title={item.label}
        subtitle={item.detail}
        mono={mono}
        disabled={item.disabled}
        selected={item.selected}
        onSelect={onChoose}
      />
    ),
    [mono, onChoose],
  );
  const searching = query.trim().length > 0;
  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <SearchField
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          accessibilityLabel={searchPlaceholder}
          autoFocus={autoFocus}
        />
        {hint ? (
          <Text variant="footnote" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.list}>
        <FlashList
          data={rows}
          keyExtractor={keyOf}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon={searching ? "search-x" : emptyIcon}
              title={searching ? "No Results" : "Nothing to Choose"}
              message={searching ? `Nothing matches “${query.trim()}”.` : emptyMessage}
            />
          }
        />
      </View>
    </View>
  );
}

/**
 * A long single choice, as the desktop combobox adapted to a sheet: a search field and the
 * options on the popover surface, the chosen option first with a check. A choice closes the sheet.
 */
export function OptionPickerSheet({
  visible,
  title,
  choices,
  error = null,
  errorTitle = "The list did not load",
  loadingLabel = "Loading",
  onRetry,
  onSelect,
  onClose,
  ...list
}: OptionPickerSheetProps): ReactElement {
  const choose = useCallback(
    (value: string) => {
      onSelect(value);
      onClose();
    },
    [onClose, onSelect],
  );
  // Android opens the keyboard for a field only in a focused window. The field of an open list
  // attaches before the sheet window has the focus, so it asks again when the sheet has opened. A
  // list that loads later focuses its field when it attaches.
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const { autoFocus } = list;
  const focusSearch = useCallback(() => {
    if (autoFocus) focusWithKeyboard(search.current);
  }, [autoFocus]);
  // The modal keeps its content while it slides out, and drops it after it closes, so the next
  // open starts with an empty search.
  let content: ReactElement;
  if (choices) {
    content = <OptionList {...list} choices={choices} searchRef={search} onChoose={choose} />;
  } else if (error) {
    content = <ErrorState title={errorTitle} message={errorMessage(error)} onRetry={onRetry} />;
  } else {
    content = <LoadingState label={loadingLabel} />;
  }
  return (
    <InPlaceSheet
      visible={visible}
      title={title}
      onClose={onClose}
      scrolls={false}
      padded={false}
      background="surface"
      onShow={focusSearch}
    >
      {content}
    </InPlaceSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  controls: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.md,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  list: { flex: 1, backgroundColor: theme.desktop.popover },
  listContent: { paddingTop: theme.space.xs, paddingBottom: theme.space.xxxl },
}));
