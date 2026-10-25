import ExpoModulesCore
import UIKit

/// Reports hardware keyboard Return presses, with their Shift state, for a descendant text input.
/// UIKit collects key commands along the responder chain from the first responder,
/// so this view receives them while a descendant text view has focus.
/// Key commands fire only for hardware keyboards. The software keyboard Return keeps inserting a newline.
final class HardwareKeyboardView: ExpoView {
  let onHardwareEnter = EventDispatcher()
  var enabled = false

  private lazy var returnCommands = [
    returnCommand(modifiers: [], action: #selector(handleReturn(_:))),
    returnCommand(modifiers: .shift, action: #selector(handleShiftReturn(_:))),
  ]

  override var keyCommands: [UIKeyCommand]? {
    return enabled ? returnCommands : nil
  }

  @objc private func handleReturn(_ command: UIKeyCommand) {
    reportReturn(shift: false)
  }

  @objc private func handleShiftReturn(_ command: UIKeyCommand) {
    reportReturn(shift: true)
  }

  private func reportReturn(shift: Bool) {
    let input = focusedTextInput()
    // Return and Shift+Return commit marked text, such as an unfinished Japanese conversion. They do not send.
    if let input = input, input.markedTextRange != nil {
      input.unmarkText()
      return
    }
    onHardwareEnter(["shift": shift])
    if shift {
      // The key command consumes the key press, so insert the newline that the text input would insert.
      input?.insertText("\n")
    }
  }

  private func returnCommand(modifiers: UIKeyModifierFlags, action: Selector) -> UIKeyCommand {
    let command = UIKeyCommand(input: "\r", modifierFlags: modifiers, action: action)
    // Without priority, the text input handles Return before the responder chain sees the key command.
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  private func focusedTextInput() -> UITextInput? {
    return firstResponderTextInput(in: self)
  }
}

@MainActor
private func firstResponderTextInput(in view: UIView) -> UITextInput? {
  if view.isFirstResponder, let input = view as? UITextInput {
    return input
  }
  for subview in view.subviews {
    if let input = firstResponderTextInput(in: subview) {
      return input
    }
  }
  return nil
}
