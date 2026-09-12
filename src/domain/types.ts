import type * as s from "@/server/schema";
export type Trip = typeof s.trips.$inferSelect;
export type Day = typeof s.days.$inferSelect;
export type Item = typeof s.items.$inferSelect;
export type Leg = typeof s.legs.$inferSelect;
export type Alternative = typeof s.alternatives.$inferSelect;
export type Participant = typeof s.participants.$inferSelect;
export type Expense = typeof s.expenses.$inferSelect;
export type Split = typeof s.splits.$inferSelect;
export type Settlement = typeof s.settlements.$inferSelect;
export type Invite = Omit<typeof s.invites.$inferSelect, "tokenHash">;
export type Member = typeof s.members.$inferSelect & {
  name: string;
  email: string;
};
export type Activity = typeof s.activity.$inferSelect & { actorName: string };
export type Comment = typeof s.comments.$inferSelect & { authorName: string };
export type DayPlan = Day & {
  items: Item[];
  legs: (Leg & { alternatives: Alternative[] })[];
};
export interface TripSnapshot {
  trip: Trip;
  currentUserId: string;
  role: Member["role"];
  days: DayPlan[];
  participants: Participant[];
  members: Member[];
  expenses: (Expense & { splits: Split[] })[];
  settlements: Settlement[];
  comments: Comment[];
  activity: Activity[];
  invites: Invite[];
}
export type Mode = Leg["mode"];
export const modeLabels: Record<Mode, string> = {
  walking: "步行",
  driving: "驾车",
  cycling: "骑行",
  transit: "公交",
  manual: "手动",
};
export const typeLabels: Record<Item["type"], string> = {
  place: "地点",
  event: "活动",
  hotel: "酒店",
  transport: "交通",
  border: "口岸",
  note: "备注",
};
export const categoryLabels: Record<string, string> = {
  transport: "交通",
  food: "餐饮",
  hotel: "住宿",
  ticket: "门票",
  shopping: "购物",
  activity: "活动",
  other: "其他",
};
