import type { NativeStackHeaderProps, NativeStackNavigationOptions } from "expo-router";
import { getHeaderTitle } from "expo-router/react-navigation";
import {
  type ComponentRef,
  type ReactElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Platform,
  StyleSheet as NativeStyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SearchBarCommands, SearchBarProps } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { IconButton } from "@/ui/icon-button";

type SearchTextEvent = Parameters<NonNullable<SearchBarProps["onChangeText"]>>[0];

/** The screens read only `nativeEvent.text` of the native search bar event. */
const searchEvent = (text: string): SearchTextEvent =>
  // SAFETY: the event carries the one field that the screens read.
  ({ nativeEvent: { text } }) as SearchTextEvent;

type HeaderSearchOptions = NonNullable<NativeStackNavigationOptions["headerSearchBarOptions"]>;

/**
 * The search of the bar: its open state, its text, and the commands of
 * `headerSearchBarOptions.ref`. As on the native search bar, Back closes an open search before it
 * leaves the screen.
 */
const useHeaderSearch = (
  search: HeaderSearchOptions | undefined,
  navigation: NativeStackHeaderProps["navigation"],
) => {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  // A screen can drop its search, for example while its list reloads. The search then shows as
  // closed, so Back leaves the screen again.
  const open = searching && search !== undefined;
  const changeQuery = (text: string): void => {
    setQuery(text);
    search?.onChangeText?.(searchEvent(text));
  };
  const close = (): void => {
    setSearching(false);
    changeQuery("");
    search?.onClose?.();
  };
  const searchRef = search?.ref;
  // The commands of `headerSearchBarOptions.ref`. As on the native search bar, a command that sets
  // the text does not call `onChangeText`, so the screen can put its own search text back in the
  // field. The native stack also mounts a native search bar in its hidden header, and that bar
  // takes the same ref in the layout phase of each render. This effect runs after it, so the
  // commands reach the field that shows.
  const commands: SearchBarCommands = {
    focus: () => {
      setSearching(true);
      input.current?.focus();
    },
    blur: () => input.current?.blur(),
    clearText: () => setQuery(""),
    setText: setQuery,
    // Only the iOS search bar has a cancel button.
    toggleCancelButton: () => undefined,
    cancelSearch: close,
  };
  useEffect(() => {
    if (!searchRef) return;
    searchRef.current = commands;
    return () => {
      if (searchRef.current === commands) searchRef.current = null;
    };
  });
  // A sheet or a screen above this one gets the Back press.
  const onBack = useEffectEvent(() => {
    if (!navigation.isFocused()) return false;
    close();
    return true;
  });
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => subscription.remove();
  }, [open]);
  return { open, query, input, changeQuery, close, start: () => setSearching(true) };
};

type HeaderSearch = ReturnType<typeof useHeaderSearch>;

/**
 * The navigation bar of a screen on Android, as the native Material toolbar: a back arrow, the
 * title, the right items, and the search of `headerSearchBarOptions`. It draws inside the screen,
 * so it moves with the screen during a swipe back. The native toolbar stays still, and after a
 * swipe back it adds its search item late, so the other items move. The search follows the
 * commands of `headerSearchBarOptions.ref`, as the native search bar does.
 */
function StackHeader({ back, options, route, navigation }: NativeStackHeaderProps): ReactElement {
  const theme = useAppTheme();
  const { top } = useSafeAreaInsets();
  const search = options.headerSearchBarOptions;
  const headerSearch = useHeaderSearch(search, navigation);
  const background =
    NativeStyleSheet.flatten(options.headerStyle)?.backgroundColor ?? theme.colors.background;
  return (
    <View style={{ paddingTop: top, backgroundColor: background }}>
      {headerSearch.open && search ? (
        <SearchRow search={search} headerSearch={headerSearch} />
      ) : (
        <TitleRow
          canGoBack={back !== undefined}
          options={options}
          routeName={route.name}
          onBack={() => navigation.goBack()}
          onSearch={search ? headerSearch.start : null}
        />
      )}
    </View>
  );
}

/** The open search: a back arrow that closes it, the search field, and a clear control. */
function SearchRow({
  search,
  headerSearch,
}: {
  search: HeaderSearchOptions;
  headerSearch: HeaderSearch;
}): ReactElement {
  const theme = useAppTheme();
  const { query, input, changeQuery, close } = headerSearch;
  return (
    <View style={styles.row}>
      <View style={styles.navigation}>
        <IconButton icon="arrow-left" size={24} accessibilityLabel="Close search" onPress={close} />
      </View>
      <TextInput
        ref={input}
        value={query}
        onChangeText={changeQuery}
        placeholder={search.placeholder}
        placeholderTextColor={theme.colors.tertiaryLabel}
        selectionColor={theme.colors.selection}
        cursorColor={theme.colors.tint}
        autoFocus
        autoCapitalize={search.autoCapitalize === "none" ? "none" : "sentences"}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={search.placeholder ?? "Search"}
        style={styles.searchInput}
      />
      {query.length > 0 ? (
        <IconButton
          icon="x"
          size={22}
          accessibilityLabel="Clear search"
          onPress={() => changeQuery("")}
        />
      ) : null}
    </View>
  );
}

/** The bar without a search: the back arrow, the title, the right items, and the search control. */
function TitleRow({
  canGoBack,
  options,
  routeName,
  onBack,
  onSearch,
}: {
  canGoBack: boolean;
  options: NativeStackNavigationOptions;
  routeName: string;
  onBack: () => void;
  /** Opens the search, or null when the screen has none. */
  onSearch: (() => void) | null;
}): ReactElement {
  const theme = useAppTheme();
  const tint = options.headerTintColor ?? theme.colors.label;
  const title = getHeaderTitle(options, routeName);
  const renderTitle = options.headerTitle;
  return (
    <View style={styles.row}>
      {canGoBack ? (
        <View style={styles.navigation}>
          <IconButton
            icon="arrow-left"
            size={24}
            accessibilityLabel="Navigate up"
            onPress={onBack}
          />
        </View>
      ) : null}
      <View style={styles.title}>
        {/* oxlint-disable-next-line anti-slop/no-runtime-typeof -- A navigation title option is a string or a render function. */}
        {typeof renderTitle === "function" ? (
          renderTitle({ children: title, tintColor: tint })
        ) : (
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={[styles.titleText, options.headerTitleStyle, { color: tint }]}
          >
            {title}
          </Text>
        )}
      </View>
      {options.headerRight?.({ tintColor: tint, canGoBack })}
      {onSearch ? (
        <IconButton icon="search" size={24} accessibilityLabel="Search" onPress={onSearch} />
      ) : null}
    </View>
  );
}

const renderStackHeader = (props: NativeStackHeaderProps): ReactElement => (
  <StackHeader {...props} />
);

const everyScreen = (): boolean => true;

/**
 * The screen options of a stack: on Android, the screens that `drawn` accepts get `StackHeader`.
 * A tab stack draws the bar of every screen. The app stack draws the bar of its pushed screens
 * only, because its sheets keep the native sheet header.
 */
export const withAndroidHeader =
  (base: NativeStackNavigationOptions, drawn: (routeName: string) => boolean = everyScreen) =>
  ({ route }: { route: { name: string } }): NativeStackNavigationOptions =>
    Platform.OS === "android" && drawn(route.name) ? { ...base, header: renderStackHeader } : base;

const styles = StyleSheet.create((theme) => ({
  // The Material toolbar: 56 high, a 56 wide navigation control, and 16 at the end.
  row: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingEnd: theme.space.lg,
    gap: theme.space.xs,
  },
  navigation: { width: 56, alignItems: "center" },
  title: { flex: 1, minWidth: 0, paddingStart: theme.space.lg },
  titleText: { color: theme.colors.label },
  searchInput: {
    ...theme.type.body,
    flex: 1,
    minWidth: 0,
    color: theme.colors.label,
  },
}));
