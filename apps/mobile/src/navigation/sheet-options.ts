import type { NativeStackNavigationOptions } from "expo-router";
import { Platform } from "react-native";

/**
 * A native form sheet with detents: a medium and a large detent, swipe down to dismiss. iOS shows
 * a grabber; Android sheets have none. Each sheet keeps a visible Cancel or Done control.
 */
export const sheetOptions = (title: string): NativeStackNavigationOptions => ({
  presentation: "formSheet",
  sheetAllowedDetents: [0.6, 1],
  sheetGrabberVisible: Platform.OS === "ios",
  sheetCornerRadius: Platform.OS === "ios" ? 24 : 28,
  sheetExpandsWhenScrolledToEdge: true,
  headerShown: true,
  title,
});

/**
 * A sheet of a few choices that open pickers, such as Message Options. On Android it keeps one
 * height. A sheet with two heights moves to its full height while a keyboard shows, also the
 * keyboard of a picker above it, and keeps that height after the keyboard closes.
 */
export const choiceSheetOptions = (title: string): NativeStackNavigationOptions =>
  Platform.OS === "android"
    ? { ...sheetOptions(title), sheetAllowedDetents: [0.6] }
    : sheetOptions(title);

/**
 * A full-height form with long content, such as task editing. iOS shows a form sheet, which asks
 * before a swipe drops unsaved edits. An Android form sheet always closes on a drag down or a tap
 * outside, before the form can ask. Android therefore shows the Material full-screen dialog, which
 * closes only with its Close control or Back. It fades in as it rises a little, so it moves in the
 * first frame; a full slide starts slowly and takes 400 ms. A form with unsaved edits asks first,
 * and a running command blocks both (see `SheetScreen`).
 */
export const fullSheetOptions = (title: string): NativeStackNavigationOptions =>
  Platform.OS === "android"
    ? { presentation: "modal", animation: "fade_from_bottom", headerShown: false, title }
    : { ...sheetOptions(title), sheetAllowedDetents: [1] };

/**
 * A compact sheet that fits its content and draws its own header with `SheetFrame`, such as Add
 * Host. A drag down closes it. `background` is the surface color of the sheet.
 */
export const compactSheetOptions = (background: string): NativeStackNavigationOptions => ({
  presentation: "formSheet",
  sheetAllowedDetents: "fitToContents",
  sheetGrabberVisible: Platform.OS === "ios",
  sheetCornerRadius: 24,
  headerShown: false,
  contentStyle: { backgroundColor: background },
});
