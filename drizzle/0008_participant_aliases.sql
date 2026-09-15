CREATE TABLE `participant_aliases` (
	`userId` text NOT NULL,
	`participantId` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`userId`, `participantId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participantId`) REFERENCES `trip_participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participant_aliases_participant_idx` ON `participant_aliases` (`participantId`);