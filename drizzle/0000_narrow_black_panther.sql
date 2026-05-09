CREATE TABLE `account_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`alias_kind` text NOT NULL,
	`alias_value` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_aliases_kind_value_unique` ON `account_aliases` (`alias_kind`,`alias_value`);--> statement-breakpoint
CREATE INDEX `account_aliases_account_idx` ON `account_aliases` (`account_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`account_number_last4` text,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`current_balance` text DEFAULT '0' NOT NULL,
	`starting_balance` text DEFAULT '0' NOT NULL,
	`starting_date` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_external` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_archived_idx` ON `accounts` (`is_archived`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`super_self_label` text,
	`super_partner_label` text,
	`tax_config` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`amount` text NOT NULL,
	`period` text NOT NULL,
	`rollover` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`parent_id` text,
	`is_system` integer DEFAULT false NOT NULL,
	`is_transfer` integer DEFAULT false NOT NULL,
	`is_payment` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 9999 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_type_parent_idx` ON `categories` (`name`,`type`,`parent_id`);--> statement-breakpoint
CREATE INDEX `categories_sort_idx` ON `categories` (`type`,`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `import_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`institution` text,
	`account_number` text,
	`rows_parsed` integer DEFAULT 0 NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`committed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `investment_prices` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`close` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_prices_unique_idx` ON `investment_prices` (`symbol`,`date`);--> statement-breakpoint
CREATE INDEX `investment_prices_symbol_idx` ON `investment_prices` (`symbol`);--> statement-breakpoint
CREATE TABLE `investment_vests` (
	`id` text PRIMARY KEY NOT NULL,
	`investment_id` text NOT NULL,
	`vest_date` text NOT NULL,
	`quantity` text NOT NULL,
	`performance_note` text,
	`is_satisfied` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`investment_id`) REFERENCES `investments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `investment_vests_investment_idx` ON `investment_vests` (`investment_id`);--> statement-breakpoint
CREATE TABLE `investments` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`symbol` text NOT NULL,
	`exchange` text NOT NULL,
	`name` text,
	`currency` text NOT NULL,
	`account_id` text,
	`quantity` text NOT NULL,
	`purchase_date` text NOT NULL,
	`purchase_price` text,
	`strike_price` text,
	`expiry_date` text,
	`service_date` text,
	`notes` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `investments_symbol_idx` ON `investments` (`symbol`);--> statement-breakpoint
CREATE TABLE `missed_scheduled_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`scheduled_id`) REFERENCES `scheduled_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `missed_scheduled_dismissals_unique_idx` ON `missed_scheduled_dismissals` (`scheduled_id`,`occurrence_date`);--> statement-breakpoint
CREATE INDEX `missed_scheduled_dismissals_scheduled_idx` ON `missed_scheduled_dismissals` (`scheduled_id`);--> statement-breakpoint
CREATE TABLE `payee_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_payee` text NOT NULL,
	`min_amount` text,
	`max_amount` text,
	`category_id` text,
	`source` text DEFAULT 'user' NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `schedule_suggestion_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`normalized_payee` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_suggestion_dismissals_unique_idx` ON `schedule_suggestion_dismissals` (`account_id`,`normalized_payee`);--> statement-breakpoint
CREATE INDEX `schedule_suggestion_dismissals_account_idx` ON `schedule_suggestion_dismissals` (`account_id`);--> statement-breakpoint
CREATE TABLE `scheduled_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduled_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`amount` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scheduled_id`) REFERENCES `scheduled_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_forecasts_unique_idx` ON `scheduled_forecasts` (`scheduled_id`,`occurrence_date`);--> statement-breakpoint
CREATE INDEX `scheduled_forecasts_scheduled_idx` ON `scheduled_forecasts` (`scheduled_id`);--> statement-breakpoint
CREATE TABLE `scheduled_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'schedule' NOT NULL,
	`account_id` text,
	`payee` text,
	`description` text,
	`amount` text NOT NULL,
	`amount_min` text,
	`type` text NOT NULL,
	`category_id` text,
	`transfer_to_account_id` text,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`day_of_month` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`lineage_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transfer_to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `superannuation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`fy_end_year` integer NOT NULL,
	`balance` text NOT NULL,
	`contributions` text DEFAULT '0' NOT NULL,
	`person` text DEFAULT 'self' NOT NULL,
	`fund_name` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `super_year_idx` ON `superannuation_snapshots` (`fy_end_year`);--> statement-breakpoint
CREATE INDEX `super_person_idx` ON `superannuation_snapshots` (`person`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` text NOT NULL,
	`payee` text,
	`normalized_payee` text,
	`match_payee` text,
	`description` text,
	`category_id` text,
	`notes` text,
	`is_transfer` integer DEFAULT false NOT NULL,
	`transfer_pair_id` text,
	`is_reconciled` integer DEFAULT false NOT NULL,
	`import_log_id` text,
	`import_hash` text,
	`raw_fitid` text,
	`type` text,
	`balance` text,
	`posted_at` integer,
	`posted_seq` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transfer_pair_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_log_id`) REFERENCES `import_logs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_hash_unique` ON `transactions` (`import_hash`);--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_normalized_payee_idx` ON `transactions` (`normalized_payee`);--> statement-breakpoint
CREATE INDEX `transactions_match_payee_idx` ON `transactions` (`match_payee`);--> statement-breakpoint
CREATE TABLE `transfer_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_suggestions_pair_idx` ON `transfer_suggestions` (`transaction_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `transfer_suggestions_txn_idx` ON `transfer_suggestions` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transfer_suggestions_cand_idx` ON `transfer_suggestions` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`exchange` text NOT NULL,
	`name` text,
	`currency` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_symbol_unique` ON `watchlist` (`symbol`);