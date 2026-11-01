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

    // Fabric mounts in a frame callback, and `View.scrollTo` asks for the redraw of the scroll view
    // on the next frame. A scroll that keeps content in place after a layout change of the same
    // mount, such as a `maintainVisibleContentPosition` correction, then shows one frame after the
    // layout change. This scroll view redraws in the frame of each scroll. Fabric reports the
    // layout of a view before it mounts the view, so a view that is not mounted yet gets the
    // listener after the next mount.
    AsyncFunction("redrawOnScroll") { viewTag: Int ->
      if (redrawOnScroll(viewTag)) return@AsyncFunction
      val reactContext = appContext.reactContext as? ReactContext ?: return@AsyncFunction
      val uiManager =
        UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) ?: return@AsyncFunction
      uiManager.addUIManagerEventListener(RedrawAfterMount(viewTag))
    }.runOnQueue(Queues.MAIN)
  }

  private fun redrawOnScroll(viewTag: Int): Boolean {
    val scrollView = appContext.findView<View>(viewTag) ?: return false
    scrollView.setOnScrollChangeListener { view, _, _, _, _ -> view.invalidate() }
    return true
  }

  /** Adds the listener after the next mount, which creates the view. */
  private inner class RedrawAfterMount(private val viewTag: Int) : UIManagerListener {
    override fun didMountItems(uiManager: UIManager) {
      uiManager.removeUIManagerEventListener(this)
      redrawOnScroll(viewTag)
    }

    override fun willDispatchViewUpdates(uiManager: UIManager) = Unit

    override fun willMountItems(uiManager: UIManager) = Unit

    override fun didDispatchMountItems(uiManager: UIManager) = Unit

    override fun didScheduleMountItems(uiManager: UIManager) = Unit
  }
}
