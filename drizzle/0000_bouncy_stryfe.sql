CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`tripId` text NOT NULL,
	`actorUserId` text NOT NULL,
	`action` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text,
	`summary` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_logs_id_unique` ON `activity_logs` (`id`);--> statement-breakpoint
CREATE INDEX `activity_trip` ON `activity_logs` (`tripId`,`sequence`);--> statement-breakpoint
CREATE TABLE `route_alternatives` (
	`id` text PRIMARY KEY NOT NULL,
	`travelLegId` text NOT NULL,
	`provider` text DEFAULT 'amap' NOT NULL,
	`fingerprint` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`distanceMeters` integer NOT NULL,
	`durationSeconds` integer NOT NULL,
	`walkingDistanceMeters` integer,
	`transferCount` integer,
	`polyline` text NOT NULL,
	`steps` text NOT NULL,
	`summary` text NOT NULL,
	`geometryComplete` integer NOT NULL,
	`fetchedAt` integer NOT NULL,
	FOREIGN KEY (`travelLegId`) REFERENCES `travel_legs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`targetType` text NOT NULL,
	`targetId` text NOT NULL,
	`authorUserId` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_target` ON `comments` (`tripId`,`targetType`,`targetId`);--> statement-breakpoint
CREATE TABLE `days` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`date` text,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`startMinutes` integer DEFAULT 480 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `days_order` ON `days` (`tripId`,`position`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`dayId` text,
	`dayItemId` text,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`currency` text NOT NULL,
	`payerParticipantId` text NOT NULL,
	`exchangeRateToBase` text NOT NULL,
	`baseAmountMinor` integer NOT NULL,
	`splitMethod` text NOT NULL,
	`splitMeta` text NOT NULL,
	`incurredAt` integer NOT NULL,
	`notes` text,
	`createdByUserId` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dayId`) REFERENCES `days`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dayItemId`) REFERENCES `day_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payerParticipantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_date` ON `expenses` (`tripId`,`incurredAt`);--> statement-breakpoint
CREATE TABLE `trip_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`role` text NOT NULL,
	`participantId` text,
	`expiresAt` integer NOT NULL,
	`maxUses` integer NOT NULL,
	`usedCount` integer DEFAULT 0 NOT NULL,
	`revokedAt` integer,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_invites_tokenHash_unique` ON `trip_invites` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `day_items` (
	`id` text PRIMARY KEY NOT NULL,
	`dayId` text NOT NULL,
	`type` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`amapPoiId` text,
	`address` text,
	`lat` real,
	`lng` real,
	`startMinutes` integer,
	`endMinutes` integer,
	`stayMinutes` integer DEFAULT 0 NOT NULL,
	`fixedTime` integer DEFAULT false NOT NULL,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`dayId`) REFERENCES `days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `items_order` ON `day_items` (`dayId`,`position`);--> statement-breakpoint
CREATE TABLE `travel_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`dayId` text NOT NULL,
	`fromItemId` text NOT NULL,
	`toItemId` text NOT NULL,
	`mode` text DEFAULT 'transit' NOT NULL,
	`provider` text DEFAULT 'amap' NOT NULL,
	`selectedAlternativeId` text,
	`selectionSource` text DEFAULT 'recommended' NOT NULL,
	`manualDurationMinutes` integer,
	`manualDistanceMeters` integer,
	`manualDescription` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`requestKey` text,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`dayId`) REFERENCES `days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fromItemId`) REFERENCES `day_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toItemId`) REFERENCES `day_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legs_day` ON `travel_legs` (`dayId`);--> statement-breakpoint
CREATE UNIQUE INDEX `legs_pair` ON `travel_legs` (`dayId`,`fromItemId`,`toItemId`);--> statement-breakpoint
CREATE TABLE `trip_members` (
	`tripId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joinedAt` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tripId`, `userId`),
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trip_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`name` text NOT NULL,
	`userId` text,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_user` ON `trip_participants` (`tripId`,`userId`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`fromParticipantId` text NOT NULL,
	`toParticipantId` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`currency` text NOT NULL,
	`exchangeRateToBase` text NOT NULL,
	`baseAmountMinor` integer NOT NULL,
	`settledAt` integer NOT NULL,
	`note` text,
	`createdByUserId` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fromParticipantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`toParticipantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`expenseId` text NOT NULL,
	`participantId` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`baseAmountMinor` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`expenseId`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `split_person` ON `expense_splits` (`expenseId`,`participantId`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`startDate` text,
	`endDate` text,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`baseCurrency` text DEFAULT 'CNY' NOT NULL,
	`baseCurrencyLockedAt` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
