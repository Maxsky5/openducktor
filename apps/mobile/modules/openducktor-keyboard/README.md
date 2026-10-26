# OpenDucktor keyboard

This local Expo module reports hardware keyboard Enter presses with their Shift state.
React Native key events do not include the Shift state.
Expo autolinking finds the module in `apps/mobile/modules`.

## API

`index.ts` exports `HardwareKeyboardView`.
Put one multiline `TextInput` inside it.

- `enabled` turns the reports on or off.
- `onHardwareEnter` receives `{ nativeEvent: { shift } }` for each hardware Enter press.
- The view also accepts all `ViewProps`.

## Rules

- Plain hardware Enter sends `shift: false` and does not insert a newline.
- Shift+Enter sends `shift: true` and inserts a newline.
- While the text input has unfinished input method text, Enter and Shift+Enter commit that text and send no event.
- The software keyboard Return key always inserts a newline and sends no event.
- When `enabled` is `false`, the text input gets all keys as usual.
- A held Enter key sends one event.

## Platforms

On iOS, the view supplies `UIKeyCommand` objects for Return and Shift+Return.
UIKit collects key commands along the responder chain, so the view receives them while the text input has focus.
The commands have priority over the text input system.
For Shift+Return, the view inserts the newline into the focused text input.
On iOS, Return and Shift+Return commit marked text, such as an unfinished Japanese conversion, and send no event.

On Android, the view group reads each key event in `dispatchKeyEventPreIme`, before the input method.
An input method in hardware keyboard mode, such as Gboard, handles Enter and passes it on without the Shift state.
The view stops both Enter and Shift+Enter, so the input method never changes them.
For Shift+Enter, the view inserts the newline into the focused text input.
While the input method has composing text, such as an unfinished Japanese conversion, the view passes Enter and Shift+Enter to it and sends no event.
It handles `KEYCODE_ENTER` and `KEYCODE_NUMPAD_ENTER` from a physical keyboard only.
It skips events from a virtual device and events with `FLAG_SOFT_KEYBOARD`.
