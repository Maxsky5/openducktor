package com.openducktor.keyboard

import android.content.Context
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager

/**
 * Opens the soft keyboard for a field. Android ignores a keyboard request from a window that does
 * not have the focus yet, such as a sheet or a dialog that has just opened, and from a field that
 * the input method does not serve yet. So the field asks after its window has the focus, and after
 * the focus change of the field has run.
 */
internal object SoftKeyboard {
  fun show(field: View) {
    field.requestFocus()
    if (field.hasWindowFocus()) {
      field.post { reveal(field) }
      return
    }
    val observer = field.viewTreeObserver
    observer.addOnWindowFocusChangeListener(
      object : ViewTreeObserver.OnWindowFocusChangeListener {
        override fun onWindowFocusChanged(hasFocus: Boolean) {
          if (!hasFocus) return
          field.viewTreeObserver.removeOnWindowFocusChangeListener(this)
          if (!field.isAttachedToWindow) return
          field.requestFocus()
          field.post { reveal(field) }
        }
      },
    )
  }

  private fun reveal(field: View) {
    if (!field.isAttachedToWindow || !field.hasFocus()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      field.windowInsetsController?.show(WindowInsets.Type.ime())
      return
    }
    val inputMethods =
      field.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    inputMethods.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
  }
}
