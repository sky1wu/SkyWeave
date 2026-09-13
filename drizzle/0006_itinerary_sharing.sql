CREATE TABLE `itinerary_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`token` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `itinerary_shares_tripId_unique` ON `itinerary_shares` (`tripId`);--> statement-breakpoint
CREATE UNIQUE INDEX `itinerary_shares_token_unique` ON `itinerary_shares` (`token`);