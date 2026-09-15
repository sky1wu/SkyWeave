import { events } from "../events";
import {
  addComment,
  createInvite,
  createParticipant,
  deleteParticipant,
  editMember,
  editParticipant,
  joinInvite,
  revokeInvite,
} from "../collaboration-service";
import { access } from "../service-core";
import { snapshot } from "../trip-service";
import {
  listParticipantAliases,
  saveParticipantAlias,
} from "../participant-alias-service";
import { expectedVersion, UNHANDLED, type ApiDispatcher } from "./dispatcher";

export const dispatchCollaboration: ApiDispatcher = ({
  request,
  path,
  root,
  id,
  action,
  subId,
  method,
  user,
  data,
}) => {
  if (root === "trips" && action === "participant-aliases") {
    if (method === "GET" && path.length === 3)
      return listParticipantAliases(id, user);
    if (method === "PATCH" && subId && path.length === 4)
      return saveParticipantAlias(id, subId, user, data);
    return UNHANDLED;
  }
  if (root === "trips" && action === "events" && method === "GET")
    return events(id, user, request);
  if (root === "trips" && action === "participants") {
    if (method === "GET") return snapshot(id, user, "members").participants;
    if (method === "POST" && !subId) return createParticipant(id, user, data);
    if (method === "PATCH" && subId)
      return editParticipant(id, subId, user, data);
    if (method === "DELETE" && subId)
      return deleteParticipant(id, subId, user, expectedVersion(data));
  } else if (root === "trips" && action === "members") {
    if (method === "GET") return snapshot(id, user, "members").members;
    if (method === "PATCH" && subId) return editMember(id, subId, user, data);
  } else if (root === "trips" && action === "invites") {
    if (method === "GET") {
      access(id, user, "owner");
      return snapshot(id, user, "members").invites;
    }
    if (method === "POST" && !subId) return createInvite(id, user, data);
    if (method === "DELETE" && subId)
      return revokeInvite(id, subId, user, expectedVersion(data));
  } else if (root === "invites" && action === "join" && method === "POST")
    return joinInvite(id, user);
  else if (root === "trips" && action === "activity" && method === "GET")
    return snapshot(id, user, "activity").activity;
  else if (root === "trips" && action === "comments") {
    if (method === "GET") return snapshot(id, user, "activity").comments;
    if (method === "POST") return addComment(id, user, data);
  }
  return UNHANDLED;
};
