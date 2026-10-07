# Visual story

## Choose the subject

Start at the level of the PR's main outcome. A navigation redesign needs a view of the new navigation. A cache guard can explain how it works in a later detail view. A detail becomes the main subject when the PR or the user's request is about that detail.

For a broad PR, group related changes into a few outcomes. Give the largest outcome the main view. Show other major outcomes in supporting callouts, another view, or the caption. Keep test additions, refactors, and small fixes in the evidence notes unless they change the explanation. Use the whole PR, rather than the last commit or the easiest function to draw, to choose the main claim.

## Choose the visual form

| Main claim | Useful composition |
| --- | --- |
| People reach or use a feature differently | Labelled UI captures or a spatial schematic of the old and new workflow |
| Ownership or module boundaries change | Blocks inside labelled boundaries, with the changed connections |
| Less work or data moves | One concrete input, with the old and new work or payload drawn to scale only when measured |
| Message order explains a protocol or race | A sequence diagram with the actors and relevant messages |
| A code expression itself is the subject | A short code comparison after its effect is clear |

For example, if task and chat pages become one session page, draw the two old destinations beside the new shared page. Put representative task and chat entries inside its sidebar groups. Show how choosing an entry opens its conversation. The page containers and grouped entries explain the change through their arrangement. A history-merge sequence can support a separate transcript claim.

If a file-refresh PR sends only changed entries, draw one edited file and compare the complete tree transfer with a small patch. Label unchanged entries as retained. Show the reset path only where it explains when a full transfer still occurs.

Use captures already supplied by the PR when they show the changed UI. Keep captures distinct from conceptual diagrams. Each capture needs a caption or callout that tells the reviewer what to look at. A schematic must not imply that its example layout is the actual app.

## Compose the view

Give the image a title that states the change, such as "Task and chat sessions share one page". Use a smaller caption for context. Put objects, boundaries, groups, and connections in the drawing. Let their arrangement carry the explanation.

For before/after comparisons, keep the example, actors, and scale stable. Label the two views. Place them side by side when both stay readable; otherwise use two images. Chronological steps inside one view remain distinct from the comparison between views. Author complete still views, since a video's final frame can omit earlier states.

Use short noun or action labels, such as "Task sessions", "Open conversation", or "Keep live messages". Put source paths, commit hashes, function names, qualifications, and full sentences in the evidence notes or PR caption. Add an identifier inside the image only when the reviewer needs it to understand the change.

Use one dominant title, smaller section labels, and readable content labels. Keep colour meanings consistent and show the same meaning with words or shapes. Use one accent for the changed part. Leave space between groups and crop unused margins. Essential labels should read at roughly 16 pixels or more when the image is about 760 pixels wide. Increase the type or reduce content instead of relying on zoom.

Use high-contrast text for object types and actions. Reserve muted type for source credits. Make connectors visible at the display width, with a clear direction when they mean an action. A preserved-state claim needs the action that preserves it, such as switching sessions, in the drawing or caption.

## Review the result

Read the rendered overview on its own. It must identify the subject, show the main before/after change or new capability, and make the practical effect clear. An image that explains only a supporting safeguard needs a broader overview. A page of sentences in boxes needs objects and relationships that carry those sentences' meaning.

Check that labels fit, connectors have clear endpoints, text has enough contrast, and the eye has a clear reading order. Remove each label that repeats the caption or adds no explanation. Keep the caption short enough that it supports the visual rather than supplies its missing story.
