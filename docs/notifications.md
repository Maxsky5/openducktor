# Notifications

OpenDucktor sends in-app notices, OS notices, and sounds for agent activity and task workflow changes. Users control each notification kind in Settings > Notifications.

## Notification kinds

Agent notifications cover permission prompts, structured questions, session errors, session starts, and optional idle sessions. Workflow notifications cover each live move to Spec Ready, Ready for Dev, In Progress, Blocked, AI Review, Human Review, and Closed. Initial task and session snapshots establish a baseline and do not notify.

Each kind has an enabled switch, a delivery target (`in_app`, `os`, or `both`), and a sound choice. A sound can use the global cue, use one of the 17 Cuelume cues, or stay silent. Disabled kinds retain their delivery and sound choices.

## Delivery rules

The frontend notification policy reads the latest saved settings for each dispatch. It deduplicates semantic occurrence IDs, applies focus rules, and runs the selected channels independently. An OS delivery error cannot stop an in-app notice or sound, and the UI reports the last OS error with a link to Notifications settings.

Electron uses native `Notification` instances in the main process and keeps them until their click or close event. Browser mode uses the Web Notifications API. A `BroadcastChannel` shares occurrences between tabs, and the Web Locks API elects one tab to send OS notices and sounds. Every tab can still show its own in-app notice.

OpenDucktor requests browser notification permission only when the user selects Test OS. OS notices always request silent delivery so Cuelume remains the only app-controlled sound source. The settings page warns when a platform cannot guarantee silent OS delivery.

## Sounds

Cuelume provides the notification cues. The first pointer or keyboard action primes its audio context with a near-silent cue because Cuelume returns before it creates the audio context when the volume is exactly zero. Preview and test actions use the current draft cue and volume without changing live-event deduplication state.

## Navigation

Notification clicks first resolve the exact loaded repository. Task targets refresh the unfiltered task list before navigation. Session targets also refresh the task session list and match `runtimeKind`, `workingDirectory`, and `externalSessionId`; OpenDucktor never opens another session as a fallback.

Agent Studio links keep only task, role, and external session ID in the normal URL. Pending-input and error links add short-lived attention keys, focus the matching safe UI target, and then remove those keys with history replacement. Closed workflow notices open the exact Kanban task details sheet.
