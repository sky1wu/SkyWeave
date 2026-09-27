DROP INDEX `legs_pair`;--> statement-breakpoint
ALTER TABLE `travel_legs` ADD `routeRole` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `legs_pair` ON `travel_legs` (`dayId`,`fromItemId`,`toItemId`,`branchId`,`routeRole`);