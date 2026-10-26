package com.openducktor.keyboard

import android.view.View
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpenDucktorKeyboardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenDucktorKeyboard")

    // Focuses a text field and opens the keyboard once its window has the focus. Returns false
    // when the field is gone, for example after its sheet closed.
    AsyncFunction("showKeyboard") { viewTag: Int ->
      val field = appContext.findView<View>(viewTag) ?: return@AsyncFunction false
      SoftKeyboard.show(field)
      true
    }.runOnQueue(Queues.MAIN)

    View(HardwareKeyboardView::class) {
      Events("onHardwareEnter")

      Prop("enabled") { view: HardwareKeyboardView, enabled: Boolean ->
        view.reportsHardwareEnter = enabled
      }
    }
  }
}
