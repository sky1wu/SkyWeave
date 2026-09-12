import { z } from "zod";
export const pointSchema = z.strictObject({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  amapPoiId: z
    .string()
    .regex(/^[A-Za-z0-9]{1,64}$/)
    .optional(),
});
export const routeRequestSchema = z.strictObject({
  mode: z.enum(["walking", "driving", "cycling", "transit"]),
  origin: pointSchema,
  destination: pointSchema,
  departureTime: z.string().datetime({ offset: true }).optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteProfile = RouteRequest["mode"];
export interface Place {
  amapPoiId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  phone?: string;
  types: string[];
}
