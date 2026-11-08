CREATE TABLE `reasoning_runs` (
  `owner_id` text NOT NULL,
  `run_id` text NOT NULL,
  `protocol` text NOT NULL,
  `state_json` text NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `expires_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`owner_id`, `run_id`)
);
--> statement-breakpoint
CREATE INDEX `reasoning_runs_owner_expiry` ON `reasoning_runs` (`owner_id`, `expires_at`);
