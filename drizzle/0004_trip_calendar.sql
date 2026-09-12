-- Normalize historical calendars without deleting any existing day or its contents.
UPDATE trips SET startDate=coalesce(startDate, (SELECT min(date) FROM days WHERE tripId=trips.id), date(createdAt/1000,'unixepoch'));
--> statement-breakpoint
UPDATE trips SET endDate=max(coalesce(endDate,startDate), date(startDate,'+' || (max(1,(SELECT count(*) FROM days WHERE tripId=trips.id))-1) || ' days'));
--> statement-breakpoint
WITH ordered AS (SELECT id,row_number() OVER (PARTITION BY tripId ORDER BY position,id)-1 position FROM days)
UPDATE days SET position=(SELECT position FROM ordered WHERE ordered.id=days.id);
--> statement-breakpoint
WITH RECURSIVE slots(tripId,position,total) AS (
  SELECT id,0,cast(julianday(endDate)-julianday(startDate) AS integer)+1 FROM trips
  UNION ALL SELECT tripId,position+1,total FROM slots WHERE position+1<total
)
INSERT INTO days(id,tripId,date,title,position,startMinutes,version,createdAt,updatedAt,updatedByUserId)
SELECT 'day_' || lower(hex(randomblob(16))),s.tripId,date(t.startDate,'+' || s.position || ' days'),'第 ' || (s.position+1) || ' 天',s.position,480,1,t.createdAt,t.updatedAt,t.updatedByUserId
FROM slots s JOIN trips t ON t.id=s.tripId
WHERE NOT EXISTS(SELECT 1 FROM days d WHERE d.tripId=s.tripId AND d.position=s.position);
--> statement-breakpoint
UPDATE days SET title='第 ' || (position+1) || ' 天',date=date((SELECT startDate FROM trips WHERE id=days.tripId),'+' || position || ' days'),version=version+1
WHERE title!='第 ' || (position+1) || ' 天' OR date IS NULL OR date!=date((SELECT startDate FROM trips WHERE id=days.tripId),'+' || position || ' days');
