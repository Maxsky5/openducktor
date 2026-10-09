ALTER TABLE `workspace_sessions` ADD `fast_mode` integer DEFAULT 0 CONSTRAINT `workspace_sessions_fast_mode` CHECK (`fast_mode` IS NULL OR `fast_mode` IN (0, 1));
