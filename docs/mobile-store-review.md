# Mobile store review guide

Use this guide to prepare the App Store and Google Play review of the OpenDucktor app for iOS and Android. The app is a client of an OpenDucktor computer. A reviewer has no such computer, so the app has a demo mode that shows its features with sample data on the device.

The demo does not guarantee store acceptance. [Apple guideline 2.1](https://developer.apple.com/app-store/review/guidelines/#app-completeness) accepts a built-in demo mode in place of a demo account only in some cases and with prior approval from Apple. [Google Play](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en) requires access to all app functionality during review.

## Reviewer steps

Give these steps to the reviewers in the App Review notes and in the Google Play app access instructions. The steps take about 20 minutes. Each step starts from the tab that it names.

1. Install the app and open it. No account, computer, network, or code is necessary.
2. On the "Connect to a host" screen, tap "Try demo" at the bottom of the card. The app opens the Sessions tab. A "Demo mode" label shows at the top of each screen.
3. Sessions: open "Explain what to do in an empty notebook". The agent asks a question. Select "Create a note", then tap "Confirm Answers". The agent continues and finishes.
4. Sessions: open "Export a notebook as Markdown". The agent asks for a permission to edit a file. Tap "Approve once" or "Reject". The agent continues.
5. Sessions: open "Why do tags drop on sync?". Type "Add a test for tag sync" in the message field and tap Send. The agent works, asks for a permission, then answers. Scroll up to the "reviewer" card and tap "Subagent session" to read the transcript of the subagent.
6. In the same session, open the session menu (three dots) and select Changes. Switch between Uncommitted changes and Branch changes, and between the list and tree views. Tap the target branch to compare with another branch. Tap a line of a diff and write a comment. The comment goes with your next message to the agent.
7. From the session menu, open Files to read code, Markdown, and the image `assets/logo.png`. Open Terminals, tap New terminal, and type `help`. The terminal says that it is simulated and lists the demo commands.
8. Sessions: tap the plus button, then "New Session". Select a new worktree, a model, and the "Reviewer" role, then start it. The setup steps run, and the session opens. In a session, tap "Fork from this reply" under an answer. From the session menu, try "Rename" and "Archive Session". Tap the archive button at the top of the Sessions tab to restore an archived session.
9. Tasks: tap "Start Spec" on "Pin notes to the top of a notebook", then "Start session". The Spec agent writes a specification, and the task moves to Spec ready.
10. Tasks: open the Spec ready column and tap "Start Planner" on "Let people search notes by title", then "Start session". The Planner writes an implementation plan, and the task moves to Ready for dev.
11. Tasks: open the Ready for dev column and tap "Start Builder" on "Restore focus after closing search". Turn on "Goal mode", tap "Generate goal", then tap "Start session". The worktree setup runs, the Builder works toward the goal, and the task moves to AI review.
12. Tasks: open the AI review column and tap "Request QA Review" on "Show an error when sync fails offline", then "Start session". The QA agent saves an approved QA Report, and the task moves to Human review.
13. Tasks: use the plus button to create a task. Open it, tap the edit button to change it, then delete it with "Delete Task" in the more actions menu at the top of the task. Use Import in the plus menu to import a sample GitHub issue.
14. Tasks: open the Human review column and tap "Approve Task" on "Open search with a keyboard shortcut". Select "Pull request", then "Write manually" (or "Ask Builder" for a generated draft), and tap "Create pull request". The task keeps its status and shows the pull request. Open the task and tap "CI Checks" to see the passing checks. Then tap "Approve Task" again, select "Direct merge", and tap "Merge locally". The task moves to Done.
15. Tasks: open any task that is not done and tap the more actions button at the top of the task. Try "Request Changes" (AI or Human review only), "Reset Implementation", "Reset Task", or "Close Task".
16. Host tab: tap "Reset demo" to restore the sample data. Tap "Exit demo" to return to host selection.

## Feature coverage

The table lists each area of the app and how the demo covers it.

| Area | In the demo | Needs a real host |
|---|---|---|
| Host selection | Try demo, theme menu | Add a host by address, code, or QR scan |
| Sessions list | Groups, search, scope, Needs you count, archived chats | None |
| Session screen | Transcript, thinking, tool calls with diffs, todos, subagent session, model picker, message options, context usage, `/goal` and `/compact` | Real model answers |
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
| Host tab | Demo host, Reset demo, Exit demo, diagnostics; Try demo from a connected host | Saved host list, pairing, remove host |
| Settings | Theme, display preferences | None |

All demo actions run on the device. They send no network request, start no shell or runtime, call no model provider, and use no credential.

## Remaining review access gaps

These parts of the app need a real OpenDucktor computer. The demo cannot show them.

- Pairing by address, pairing code, or QR scan, and the camera permission of the QR scan.
- Connection recovery: reconnect after the background, network changes, and host restarts.
- Real agent runtimes and model providers.
- Real Git, files, and shell commands on the computer.
- Git conflict resolution. The sample data has no conflict. If demo changes overlap, Direct Merge stops, names the files, and changes nothing.
- Pull requests on the web and merged pull requests. The sample pull request stays open and has no web page.
- Web links and web images in Markdown. The demo shows a notice instead.

## Privacy check

The [privacy policy](https://openducktor.dev/privacy/), dated 9 November 2026, says that the app connects to the computer that the user adds and sends instructions, task changes, permission responses, terminal input, and selected attachments to it. The demo sends nothing, so the policy needs a demo exception. Proposed text for a new paragraph in "Your computer and your providers":

> In demo mode, sample data and your changes stay in memory on this device. The demo sends no prompts, task changes, terminal input, or selected attachments to a computer or model provider. Reset demo, Exit demo, or closing the app discards this state. Opened previews can use temporary files. Theme and display preferences remain device settings.

The demo adds no data collection and no new permission. The Android QR scanner disclosure stays as it is, because the demo does not open the scanner.

## Store metadata updates

- App Review notes (App Store Connect): paste the short notes below. The Notes field holds at most 4,000 bytes, so the notes link to this guide for the full steps, the coverage table, and the access gaps.
- Google Play app access: select that all or some functionality is restricted, and give the short notes below as the instructions. No username or password is necessary.
- Store descriptions and screenshots that say a computer is necessary for all use can add that a demo with sample data is available.
- The App Privacy answers and the Google Play Data safety form need no change, because the demo collects and sends no data.

### Short review notes

Use this text in the App Review notes and the Google Play app access instructions. It is shorter than 4,000 bytes.

```text
OpenDucktor controls AI coding agents that run on the user's own computer. A reviewer has no such computer, so the app has a built-in demo mode with sample data on the device. No sign-in, account, network, or code is necessary. We ask Apple to approve this demo mode in place of a demo account.

1. Open the app. On "Connect to a host", tap "Try demo". A "Demo mode" label shows on each screen.
2. Sessions: open "Explain what to do in an empty notebook", select "Create a note", and tap "Confirm Answers".
3. Sessions: open "Export a notebook as Markdown" and tap "Approve once".
4. Sessions: open "Why do tags drop on sync?", send "Add a test for tag sync", and approve the edit. Tap "Subagent session" on the reviewer card. From the session menu (three dots), open Changes, Files, and Terminals (type help).
5. Sessions: tap the plus button, then "New Session", and start a session in a new worktree.
6. Tasks: tap "Start Spec" on "Pin notes to the top of a notebook", "Start Planner" on "Let people search notes by title", "Start Builder" on "Restore focus after closing search" (try "Goal mode" and "Generate goal"), and "Request QA Review" on "Show an error when sync fails offline". Each start opens a sheet; tap "Start session".
7. Tasks: create, edit, and delete a task. Use Import in the plus menu to import a sample issue.
8. Tasks: tap "Approve Task" on "Open search with a keyboard shortcut". Try "Pull request" with "Write manually", then open the task and tap "CI Checks". Approve again with "Direct merge".
9. Host tab: "Reset demo" restores the sample data. "Exit demo" returns to host selection.

All demo actions stay on the device. A real computer is necessary for pairing (address, code, or QR scan), connection recovery, real agents and model providers, real Git, files, and shell commands, Git conflict resolution, and pull requests on the web.

Full guide: https://github.com/Maxsky5/openducktor/blob/main/docs/mobile-store-review.md
```
