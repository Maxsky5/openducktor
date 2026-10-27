ALTER TABLE `tasks` ADD `remove_worktree_on_close` integer CONSTRAINT "chk_tasks_remove_worktree_on_close" CHECK("remove_worktree_on_close" in (0, 1));
