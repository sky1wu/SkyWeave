CREATE TABLE `trip_places` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'place' NOT NULL,
	`placeCategory` text DEFAULT '未分类' NOT NULL,
	`amapPoiId` text,
	`address` text,
	`lat` real,
	`lng` real,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updatedByUserId` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pool_poi` ON `trip_places` (`tripId`,`amapPoiId`);--> statement-breakpoint
CREATE INDEX `pool_category` ON `trip_places` (`tripId`,`placeCategory`);--> statement-breakpoint
ALTER TABLE `day_items` ADD `sourcePlaceId` text REFERENCES trip_places(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `day_items` ADD `placeCategory` text DEFAULT '未分类' NOT NULL;
--> statement-breakpoint
UPDATE days AS d SET date = date(
  coalesce((SELECT p.date FROM days p WHERE p.tripId=d.tripId AND p.position<d.position AND p.date IS NOT NULL ORDER BY p.position DESC LIMIT 1), (SELECT t.startDate FROM trips t WHERE t.id=d.tripId)),
  '+' || (d.position - coalesce((SELECT p.position FROM days p WHERE p.tripId=d.tripId AND p.position<d.position AND p.date IS NOT NULL ORDER BY p.position DESC LIMIT 1), 0)) || ' days'
), version=version+1
WHERE d.date IS NULL AND ((SELECT t.startDate FROM trips t WHERE t.id=d.tripId) IS NOT NULL OR EXISTS (SELECT 1 FROM days p WHERE p.tripId=d.tripId AND p.position<d.position AND p.date IS NOT NULL));
--> statement-breakpoint
INSERT INTO trip_places (id,tripId,title,type,placeCategory,amapPoiId,address,lat,lng,notes,version,createdAt,updatedAt,updatedByUserId)
SELECT 'pool_' || id, tripId, title, type,
  CASE type WHEN 'hotel' THEN '住宿' WHEN 'event' THEN '活动' WHEN 'transport' THEN '交通' WHEN 'border' THEN '交通' ELSE '未分类' END,
  amapPoiId,address,lat,lng,notes,1,createdAt,updatedAt,updatedByUserId
FROM (
  SELECT i.*,d.tripId,row_number() OVER (PARTITION BY d.tripId,coalesce(i.amapPoiId,i.id) ORDER BY i.createdAt,i.id) AS poolRank
  FROM day_items i JOIN days d ON d.id=i.dayId
  WHERE i.type!='note' AND i.lat IS NOT NULL AND i.lng IS NOT NULL
) WHERE poolRank=1;

--> statement-breakpoint
UPDATE day_items SET sourcePlaceId=(SELECT p.id FROM trip_places p JOIN days d ON d.tripId=p.tripId WHERE d.id=day_items.dayId AND ((day_items.amapPoiId IS NOT NULL AND p.amapPoiId=day_items.amapPoiId) OR p.id='pool_' || day_items.id)),
placeCategory=CASE type WHEN 'hotel' THEN '住宿' WHEN 'event' THEN '活动' WHEN 'transport' THEN '交通' WHEN 'border' THEN '交通' ELSE '未分类' END;
