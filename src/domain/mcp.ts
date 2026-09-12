export interface McpToken {
  id: string;
  name: string;
  tokenPrefix: string;
  permission: "read" | "edit";
  tripId: string | null;
  tripTitle: string | null;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
}
