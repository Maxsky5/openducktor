import ExpoModulesCore

public final class OpenDucktorKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenDucktorKeyboard")

    View(HardwareKeyboardView.self) {
      Events("onHardwareEnter")

      Prop("enabled") { (view: HardwareKeyboardView, enabled: Bool) in
        view.enabled = enabled
      }
    }
  }
}
