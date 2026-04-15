# Verification Records

This folder holds task-scoped local verification records when QA needs a repo-visible trail for required command results.

Use a task-specific file such as `openducktor-770.md` when a change needs branch-local evidence beyond the task metadata or chat transcript.

Each record should capture:
- the task id and scope being verified
- the required commands that were run
- the observed pass/fail result summary
- any known unrelated console noise that appeared during the run

Refresh the task-specific record whenever a later commit changes the branch head before requesting QA again.
