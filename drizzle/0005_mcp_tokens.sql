CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`permission` text NOT NULL,
	`tripId` text,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`lastUsedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_tokenHash_unique` ON `mcp_tokens` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_user_idx` ON `mcp_tokens` (`userId`);