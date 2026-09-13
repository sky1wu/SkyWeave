import { events } from "../events";
import {
  addComment,
  createInvite,
  createParticipant,
  editMember,
  editParticipant,
  joinInvite,
  revokeInvite,
} from "../collaboration-service";
import { access } from "../service-core";
import { snapshot } from "../trip-service";
import { expectedVersion, UNHANDLED, type ApiDispatcher } from "./dispatcher";

export const dispatchCollaboration: ApiDispatcher = ({
  request,
  root,
  id,
  action,
  subId,
  method,
  user,
  data,
}) => {
  if (root === "trips" && action === "events" && method === "GET")
    return events(id, user, request);
  if (root === "trips" && action === "participants") {
    if (method === "GET") return snapshot(id, user).participants;
    if (method === "POST" && !subId) return createParticipant(id, user, data);
    if (method === "PATCH" && subId)
      return editParticipant(id, subId, user, data);
  } else if (root === "trips" && action === "members") {
    if (method === "GET") return snapshot(id, user).members;
    if (method === "PATCH" && subId) return editMember(id, subId, user, data);
  } else if (root === "trips" && action === "invites") {
    if (method === "GET") {
      access(id, user, "owner");
      return snapshot(id, user).invites;
    }
    if (method === "POST" && !subId) return createInvite(id, user, data);
    if (method === "DELETE" && subId)
      return revokeInvite(id, subId, user, expectedVersion(data));
  } else if (root === "invites" && action === "join" && method === "POST")
    return joinInvite(id, user);
  else if (root === "trips" && action === "activity" && method === "GET")
    return snapshot(id, user).activity;
  else if (root === "trips" && action === "comments") {
    if (method === "GET") return snapshot(id, user).comments;
    if (method === "POST") return addComment(id, user, data);
  }
  return UNHANDLED;
};
