CREATE TABLE `travel_leg_preferences` (
	`fromItemId` text NOT NULL,
	`toItemId` text NOT NULL,
	`branchId` text DEFAULT '' NOT NULL,
	`routeRole` text DEFAULT 'main' NOT NULL,
	`mode` text NOT NULL,
	`manualDurationMinutes` integer,
	`manualDistanceMeters` integer,
	`manualDescription` text,
	PRIMARY KEY(`fromItemId`, `toItemId`, `branchId`, `routeRole`),
	FOREIGN KEY (`fromItemId`) REFERENCES `day_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toItemId`) REFERENCES `day_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leg_preferences_to_item` ON `travel_leg_preferences` (`toItemId`);--> statement-breakpoint
CREATE TABLE `trip_route_preferences` (
	`tripId` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
