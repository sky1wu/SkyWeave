import {
  TRIP_FILE_FORMAT,
  TRIP_FILE_VERSION,
  MAX_TRIP_FILE_BYTES,
  TRIP_FILE_SIZE_MESSAGE,
  tripFilename,
} from "@/domain/trip-file";
import { insert } from "./db";
import { AppError } from "./errors";
import { log, revision, tx, uid, type Actor } from "./service-core";
import { snapshot } from "./trip-service";
import { fileTrip, tripFileSchema, parseTripFile } from "./trip-file-schema";

export function exportTripFile(tripId: string, actor: Actor) {
  // Always read a full, consistent snapshot; UI section snapshots omit data.
  const data = snapshot(tripId, actor);
  // Schemas allowlist portable fields, removing user IDs, tokens and audit data.
  return tripFileSchema.parse({
    ...data,
    format: TRIP_FILE_FORMAT,
    version: TRIP_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    trip: fileTrip.parse({
      ...data.trip,
      baseCurrencyLocked: data.trip.baseCurrencyLockedAt !== null,
    }),
  });
}

export function tripFileResponse(tripId: string, actor: Actor) {
  const file = exportTripFile(tripId, actor);
  const content = JSON.stringify(file, null, 2) + "\n";
  if (Buffer.byteLength(content) > MAX_TRIP_FILE_BYTES)
    throw new AppError(413, "BODY_TOO_LARGE", TRIP_FILE_SIZE_MESSAGE);
  const filename = encodeURIComponent(tripFilename(file.trip.title)).replace(
    /['()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(content, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="trip.skyweave.json"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function importTripFile(actor: Actor, body: unknown) {
  const file = parseTripFile(body);
  return tx(() => {
    const tripId = uid();
    const rev = revision(actor);
    const ids = new Map<string, string>();
    const assign = (rows: { id: string }[]) =>
      rows.forEach((row) => ids.set(row.id, uid()));
    assign(file.poolPlaces);
    // Remainder allocation breaks ties by participant ID. Preserve that order
    // while generating new IDs so future exports validate the same rounded splits.
    const people = [...file.participants].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const personIds = people
      .map(() => uid())
      .sort((a, b) => a.localeCompare(b));
    people.forEach((person, i) => ids.set(person.id, personIds[i]));
    assign(file.days);
    assign(file.expenses);
    assign(file.settlements);
    for (const day of file.days) {
      assign(day.items);
      assign(day.legs);
      day.legs.forEach((leg) => assign(leg.alternatives));
    }
    const ref = (id: string) => ids.get(id)!;
    const optionalRef = (id: string | null | undefined) =>
      id == null ? null : ref(id);
    const { baseCurrencyLocked, ...trip } = file.trip;
    insert("trips", {
      ...trip,
      id: tripId,
      ...rev,
      baseCurrencyLockedAt:
        baseCurrencyLocked || file.expenses.length || file.settlements.length
          ? rev.createdAt
          : null,
    });
    insert("trip_members", {
      tripId,
      userId: actor.id,
      role: "owner",
      joinedAt: rev.createdAt,
    });
    for (const [position, place] of file.poolPlaces.entries())
      insert("trip_places", {
        ...place,
        id: ref(place.id),
        tripId,
        position,
        ...rev,
      });
    for (const participant of file.participants)
      insert("trip_participants", {
        ...participant,
        id: ref(participant.id),
        tripId,
        userId: null,
        ...rev,
      });
    for (const [position, day] of file.days.entries()) {
      const { items, legs, ...fields } = day;
      const dayId = ref(day.id);
      insert("days", { ...fields, id: dayId, tripId, position, ...rev });
      for (const [position, item] of items.entries()) {
        const transport = item.transport
          ? {
              ...item.transport,
              origin: {
                ...item.transport.origin,
                sourcePlaceId: optionalRef(item.transport.origin.sourcePlaceId),
              },
              destination: {
                ...item.transport.destination,
                sourcePlaceId: optionalRef(
                  item.transport.destination.sourcePlaceId,
                ),
              },
            }
          : null;
        insert("day_items", {
          ...item,
          id: ref(item.id),
          dayId,
          position,
          sourcePlaceId: optionalRef(item.sourcePlaceId),
          transport,
          ...rev,
        });
      }
      for (const leg of legs) {
        const { alternatives, ...fields } = leg;
        const travelLegId = ref(leg.id);
        insert("travel_legs", {
          ...fields,
          id: travelLegId,
          dayId,
          fromItemId: ref(leg.fromItemId),
          toItemId: ref(leg.toItemId),
          selectedAlternativeId: optionalRef(leg.selectedAlternativeId),
          ...rev,
        });
        for (const [position, alternative] of alternatives.entries())
          insert("route_alternatives", {
            ...alternative,
            id: ref(alternative.id),
            travelLegId,
            position,
          });
      }
    }
    for (const expense of file.expenses) {
      const { splits, ...fields } = expense;
      const expenseId = ref(expense.id);
      insert("expenses", {
        ...fields,
        id: expenseId,
        tripId,
        dayId: optionalRef(expense.dayId),
        dayItemId: optionalRef(expense.dayItemId),
        payerParticipantId: ref(expense.payerParticipantId),
        splitMeta: expense.splitMeta.map((split) => ({
          ...split,
          participantId: ref(split.participantId),
        })),
        createdByUserId: actor.id,
        ...rev,
      });
      for (const split of splits)
        insert("expense_splits", {
          ...split,
          id: uid(),
          expenseId,
          participantId: ref(split.participantId),
          createdAt: rev.createdAt,
        });
    }
    for (const settlement of file.settlements)
      insert("settlements", {
        ...settlement,
        id: ref(settlement.id),
        tripId,
        fromParticipantId: ref(settlement.fromParticipantId),
        toParticipantId: ref(settlement.toParticipantId),
        createdByUserId: actor.id,
        ...rev,
      });
    log(
      tripId,
      actor,
      "trip.imported",
      "trip",
      tripId,
      `从文件导入了行程「${trip.title}」`,
    );
    return { id: tripId };
  });
}
