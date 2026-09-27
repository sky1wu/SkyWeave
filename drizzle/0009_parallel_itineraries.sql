DROP INDEX `legs_pair`;--> statement-breakpoint
ALTER TABLE `travel_legs` ADD `branchId` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `legs_pair` ON `travel_legs` (`dayId`,`fromItemId`,`toItemId`,`branchId`);--> statement-breakpoint
ALTER TABLE `day_items` ADD `branchId` text;--> statement-breakpoint
ALTER TABLE `day_items` ADD `parallelPlan` text;