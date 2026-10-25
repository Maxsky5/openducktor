package com.openducktor.keyboard

import android.content.Context
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Reports hardware keyboard Enter presses, with their Shift state, for a descendant text input.
 * The view reads each key press before the input method. An input method in hardware keyboard
 * mode, such as Gboard, handles Enter itself and passes it on without Shift, so a later check would
 * read Shift+Enter as Enter. Both presses stop here: plain Enter only reports, and Shift+Enter also
 * inserts the line break.
 */
class HardwareKeyboardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var reportsHardwareEnter = false
  private val onHardwareEnter by EventDispatcher<Map<String, Any>>()

  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean {
    if (!reportsHardwareEnter || !isHardwareEnter(event)) {
      return super.dispatchKeyEventPreIme(event)
    }
    val input = findFocus() as? EditText
    // Enter commits unfinished input method text, such as a Japanese conversion. It does not send.
    if (input != null && BaseInputConnection.getComposingSpanStart(input.text) != -1) {
      return super.dispatchKeyEventPreIme(event)
    }
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      onHardwareEnter(mapOf("shift" to event.isShiftPressed))
      if (event.isShiftPressed && input != null) insertLineBreak(input)
    }
    return true
  }
}

private fun insertLineBreak(input: EditText) {
  val text = input.text
  val start = minOf(input.selectionStart, input.selectionEnd).coerceAtLeast(0)
  val end = maxOf(input.selectionStart, input.selectionEnd).coerceAtLeast(0)
  text.replace(start, end, "\n")
}

private fun isHardwareEnter(event: KeyEvent): Boolean {
  if (event.keyCode != KeyEvent.KEYCODE_ENTER && event.keyCode != KeyEvent.KEYCODE_NUMPAD_ENTER) {
    return false
  }
  val device = event.device ?: return false
  // A software keyboard sends key events from a virtual device or with FLAG_SOFT_KEYBOARD.
  return !device.isVirtual && (event.flags and KeyEvent.FLAG_SOFT_KEYBOARD) == 0
}
