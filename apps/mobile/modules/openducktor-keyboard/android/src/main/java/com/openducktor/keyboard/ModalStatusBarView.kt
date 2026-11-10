package com.openducktor.keyboard

import android.content.Context
import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** Styles the dialog window that owns this view, rather than the activity window. */
class ModalStatusBarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var darkIcons = false
    set(value) {
      field = value
      applyStyle()
    }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyStyle()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (hasWindowFocus) applyStyle()
  }

  @Suppress("DEPRECATION")
  private fun applyStyle() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val flag = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
      windowInsetsController?.setSystemBarsAppearance(if (darkIcons) flag else 0, flag)
    } else {
      val flag = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      rootView.systemUiVisibility =
        if (darkIcons) rootView.systemUiVisibility or flag
        else rootView.systemUiVisibility and flag.inv()
    }
  }
}
