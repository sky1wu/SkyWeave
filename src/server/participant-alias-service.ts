import { z } from "zod";
import type { ParticipantAlias } from "@/domain/types";
import { insert, many, one, run } from "./db";
import { AppError, requireValue } from "./errors";
import { access, readTx, tx, type Actor } from "./service-core";

export function listParticipantAliases(tripId: string, actor: Actor) {
  return readTx(() => {
    access(tripId, actor);
    return many<ParticipantAlias>(
      "SELECT a.participantId, a.name, a.version FROM participant_aliases a JOIN trip_participants p ON p.id=a.participantId WHERE p.tripId=? AND a.userId=? ORDER BY a.participantId",
      tripId,
      actor.id,
    );
  });
}

export function saveParticipantAlias(
  tripId: string,
  participantId: string,
  actor: Actor,
  body: unknown,
): ParticipantAlias {
  const data = z
    .strictObject({
      name: z.string().trim().max(100),
      expectedVersion: z.number().int().nonnegative(),
    })
    .parse(body);
  return tx(() => {
    // A personal alias is available to every active member, including viewers.
    access(tripId, actor);
    requireValue(
      one(
        "SELECT id FROM trip_participants WHERE id=? AND tripId=?",
        participantId,
        tripId,
      ),
    );
    const current = one<ParticipantAlias>(
      "SELECT participantId, name, version FROM participant_aliases WHERE participantId=? AND userId=?",
      participantId,
      actor.id,
    );
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new AppError(
        409,
        "CONFLICT",
        "备注名已在其他页面修改，请重新打开后重试",
      );
    const result = {
      participantId,
      name: data.name,
      version: (current?.version ?? 0) + 1,
    };
    if (current)
      run(
        "UPDATE participant_aliases SET name=?, version=? WHERE participantId=? AND userId=?",
        result.name,
        result.version,
        participantId,
        actor.id,
      );
    else insert("participant_aliases", { ...result, userId: actor.id });
    // Keep an empty alias's version to reject stale writes after clearing it.
    // Personal changes never enter shared snapshots, activity logs or SSE.
    return result;
  });
}
