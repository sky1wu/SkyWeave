import type { ParticipantAlias, TripSnapshot } from "./types";

// A display-only copy: personal names must never enter the shared trip store.
export function withParticipantAliases<T extends TripSnapshot>(
  snapshot: T,
  aliases: ParticipantAlias[] | null,
): T {
  const names = new Map(
    aliases
      ?.filter((alias) => alias.name)
      .map((alias) => [alias.participantId, alias.name]),
  );
  if (!names.size) return snapshot;
  const userNames = new Map<string, string>();
  const participants = snapshot.participants.map((person) => {
    const name = names.get(person.id);
    if (!name) return person;
    if (person.userId) userNames.set(person.userId, name);
    return { ...person, name };
  });
  return {
    ...snapshot,
    participants,
    members: snapshot.members.map((member) => {
      const name = userNames.get(member.userId);
      return name ? { ...member, name } : member;
    }),
    comments: snapshot.comments.map((comment) => {
      const name = userNames.get(comment.authorUserId);
      return name ? { ...comment, authorName: name } : comment;
    }),
    activity: snapshot.activity.map((activity) => {
      const name = userNames.get(activity.actorUserId);
      return name ? { ...activity, actorName: name } : activity;
    }),
  };
}
