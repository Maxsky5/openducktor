package com.openducktor.scroll

import android.view.View
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

@OptIn(UnstableReactNativeAPI::class)
class OpenDucktorScrollModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenDucktorScroll")

    // `View.scrollTo` asks for the redraw of the scroll view on the next frame, but a layout change
    // in the same mount draws in the current frame. A scroll that keeps content in place after a
    // layout change then shows one frame late. This scroll view redraws in the frame of each
    // scroll. Fabric reports a layout before it mounts the view, so a view that is not mounted yet
    // gets the redraw after the next mount.
    Function("redrawOnScroll") { viewTag: Int ->
      val context = appContext.reactContext as? ReactContext ?: return@Function
      val uiManager = UIManagerHelper.getUIManager(context, UIManagerType.FABRIC) ?: return@Function
      context.runOnUiQueueThread {
        if (!redrawOnScroll(uiManager, viewTag)) {
          uiManager.addUIManagerEventListener(RedrawAfterMount(viewTag))
        }
      }
    }
  }
}

@OptIn(UnstableReactNativeAPI::class)
private fun redrawOnScroll(uiManager: UIManager, viewTag: Int): Boolean {
  val scrollView = runCatching { uiManager.resolveView(viewTag) }.getOrNull() ?: return false
  scrollView.setOnScrollChangeListener { view: View, _, _, _, _ -> view.invalidate() }
  return true
}

@OptIn(UnstableReactNativeAPI::class)
private class RedrawAfterMount(private val viewTag: Int) : UIManagerListener {
  override fun didMountItems(uiManager: UIManager) {
    if (redrawOnScroll(uiManager, viewTag)) uiManager.removeUIManagerEventListener(this)
  }

  override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

  override fun willMountItems(uiManager: UIManager) = Unit

  override fun didDispatchMountItems(uiManager: UIManager) = Unit

  override fun didScheduleMountItems(uiManager: UIManager) = Unit
}
