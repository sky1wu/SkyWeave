ALTER TABLE `trip_places` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tripId ORDER BY createdAt, id) - 1 AS position
  FROM trip_places
)
UPDATE trip_places SET position = (SELECT position FROM ordered WHERE ordered.id = trip_places.id);
