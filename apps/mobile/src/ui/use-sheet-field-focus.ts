import { useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ComponentRef, type RefCallback, useCallback, useEffect, useRef } from "react";
import { Platform, type TextInput } from "react-native";
import { focusWithKeyboard } from "./focus-with-keyboard";

type Field = ComponentRef<typeof TextInput>;

export type SheetFieldFocus = {
  /** The ref of the field to focus. */
  ref: RefCallback<Field>;
  /** Pass it to the field as `autoFocus`. */
  autoFocus: boolean;
};

/**
 * Focuses the main field of a sheet route and opens the keyboard. iOS opens the keyboard with the
 * sheet through `autoFocus`. An Android field with `autoFocus` gets focus while the sheet animates
 * in, but the keyboard stays closed, so on Android the field gets focus when the sheet has opened.
 * A field that mounts after that, such as after a read, gets focus at once. Only the first opening
 * focuses the field, so a return from a sheet above it does not open the keyboard again.
 */
export function useSheetFieldFocus(): SheetFieldFocus {
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const field = useRef<Field | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (Platform.OS === "ios") return;
    return navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing || opened.current) return;
      opened.current = true;
      focusWithKeyboard(field.current);
    });
  }, [navigation]);
  const ref = useCallback((input: Field | null) => {
    field.current = input;
    if (input && opened.current) focusWithKeyboard(input);
  }, []);
  return { ref, autoFocus: Platform.OS === "ios" };
}
