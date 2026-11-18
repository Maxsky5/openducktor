# Mobile store review guide

Use this guide to prepare the App Store and Google Play review of the OpenDucktor app for iOS and Android. The app is a client of an OpenDucktor computer. A reviewer has no such computer, so the app has a demo mode that shows its features with sample data on the device.

The demo does not guarantee store acceptance. [Apple guideline 2.1](https://developer.apple.com/app-store/review/guidelines/#app-completeness) accepts a built-in demo mode in place of a demo account only in some cases and with prior approval from Apple. [Google Play](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en) requires access to all app functionality during review.

## Reviewer steps

Give these steps to the reviewers in the App Review notes and in the Google Play app access instructions. The steps take about 15 minutes. Each step starts from the tab that it names.

1. Install the app and open it. No account, computer, network, or code is necessary.
2. On the "Connect to a host" screen, tap "Try demo" at the bottom of the card. The app opens the Sessions tab. A "Demo mode" label shows at the top of each screen.
3. Sessions: open "Explain what to do in an empty notebook". The agent asks a question. Select "Create a note", then tap "Confirm Answers". The agent continues and finishes.
4. Sessions: open "Export a notebook as Markdown". The agent asks for a permission to edit a file. Tap "Approve once" or "Reject". The agent continues.
5. Sessions: open "Why do tags drop on sync?". Type "Add a test for tag sync" in the message field and tap Send. The agent works, asks for a permission, then answers. Scroll up to the "reviewer" card and tap "Subagent session" to read the transcript of the subagent.
6. In the same session, open the session menu (three dots) and select Changes. Switch between Uncommitted changes and Branch changes, and between the list and tree views. Tap the target branch to compare with another branch. Tap a line of a diff and write a comment. The comment goes with your next message to the agent.
7. From the session menu, open Files to read code, Markdown, and the image `assets/logo.png`. Open Terminals, tap New terminal, and type `help`. The terminal says that it is simulated and lists the demo commands.
8. Sessions: tap the plus button, then "New Session". Select a new worktree, a model, and the "Reviewer" role, then start it. The setup steps run, and the session opens. In a session, tap "Fork from this reply" under an answer. From the session menu, try "Rename" and "Archive Session". Tap the archive button at the top of the Sessions tab to restore an archived session.
9. Tasks: tap "Start Spec" on "Pin notes to the top of a notebook", then "Start session". The Spec agent writes a specification, and the task moves to Spec ready.
10. Tasks: open the Ready for dev column and tap "Start Builder" on "Restore focus after closing search". Turn on "Goal mode", tap "Generate goal", then tap "Start session". The worktree setup runs, the Builder works toward the goal, and the task moves to AI review.
11. Tasks: use the plus button to create a task, open it to edit it, and delete it from its menu. Use Import to import a sample GitHub issue.
12. Tasks: open "Open search with a keyboard shortcut" (Human review). Tap Approve to try Direct Merge, or Pull Request with "Write manually" or a generated draft. Then open Checks.
13. Tasks: on "Show an error when sync fails offline" (AI review), tap the more actions button of the card. Try "Request Changes", "Reset Implementation", "Reset Task", or "Close Task".
14. Host tab: tap "Reset demo" to restore the sample data. Tap "Exit demo" to return to host selection.

## Feature coverage

The table lists each area of the app and how the demo covers it.

| Area | In the demo | Needs a real host |
|---|---|---|
| Host selection | Try demo, theme menu | Add a host by address, code, or QR scan |
| Sessions list | Groups, search, scope, Needs you count, archived chats | None |
| Session screen | Transcript, thinking, tool calls with diffs, todos, subagent session, model picker, message options, context usage | Real model answers |
| Prompts | Scripted answers within about 15 seconds, queue, stop | Real agent work |
| Questions and permissions | Answer, allow, and reject | None |
| New session | Current checkout, new worktree with setup steps, existing worktree, model, custom role | None |
| Chat actions | Rename, fork, archive, restore | None |
| Tasks board | Board, search, filters, workspace switcher | None |
| Task details | Fields, documents, artifacts, sessions, actions | None |
| Create and edit tasks | Fields, labels, description images | None |
| Workflow actions | Start Spec, Planning, Build, QA, Goal mode with a generated goal, Request Changes, Reset Implementation, Reset Task, Close | Goals that a real model writes |
| Approval | Direct Merge, Pull Request with a written or generated draft, Checks | Opening a pull request on the web |
| Issue import | Sample GitHub issues | Real GitHub issues |
| Changes and Files | Uncommitted and branch changes against any demo branch, added, changed, and deleted files, inline comments, file tree, code, Markdown, image | None |
| Terminals | New terminal, repository actions, scripted commands, key bar, restart, close | Real shell commands |
| Host tab | Demo host, Reset demo, Exit demo, diagnostics | Saved host list, pairing, remove host |
| Settings | Theme, display preferences | None |

All demo actions run on the device. They send no network request, start no shell or runtime, call no model provider, and use no credential.

## Remaining review access gaps

These parts of the app need a real OpenDucktor computer. The demo cannot show them.

- Pairing by address, pairing code, or QR scan, and the camera permission of the QR scan.
- Connection recovery: reconnect after the background, network changes, and host restarts.
- Real agent runtimes and model providers.
- Real Git, files, and shell commands on the computer.
- Git conflict resolution. The sample data has no conflict.
- Pull requests on the web and merged pull requests. The sample pull request stays open and has no web page.
- Web links and web images in Markdown. The demo shows a notice instead.

## Privacy check

The [privacy policy](https://openducktor.dev/privacy/), dated 9 November 2026, says that the app connects to the computer that the user adds and sends instructions, task changes, permission responses, terminal input, and selected attachments to it. The demo sends nothing, so the policy needs a demo exception. Proposed text for a new paragraph in "Your computer and your providers":

> In demo mode, sample data and your changes stay in memory on this device. The demo sends no prompts, task changes, terminal input, or selected attachments to a computer or model provider. Reset demo, Exit demo, or closing the app discards this state. Opened previews can use temporary files. Theme and display preferences remain device settings.

The demo adds no data collection and no new permission. The Android QR scanner disclosure stays as it is, because the demo does not open the scanner.

## Store metadata updates

- App Review notes (App Store Connect): add the reviewer steps, the coverage table, and the access gaps. State that the app needs no sign-in, and ask Apple to approve the demo mode in place of a demo account.
- Google Play app access: select that all or some functionality is restricted, and give the reviewer steps as the instructions. No user name or password is necessary.
- Store descriptions and screenshots that say a computer is necessary for all use can add that a demo with sample data is available.
- The App Privacy answers and the Google Play Data safety form need no change, because the demo collects and sends no data.
