import { z } from "zod";

// Optional AMap scalars are often [], null, empty strings or numeric strings.
const scalar = z
  .union([
    z.string().max(4096),
    z.number().finite(),
    z.array(z.unknown()).max(0),
    z.null(),
  ])
  .optional();
const business = z.object({ tel: scalar, rating: scalar }).catch({});

export const poiSchema = z.object({
  id: scalar,
  name: scalar,
  location: scalar,
  pname: scalar,
  cityname: scalar,
  adname: scalar,
  address: scalar,
  typecode: scalar,
  business: business.optional(),
});

export const tipSchema = z.object({
  id: scalar,
  name: scalar,
  location: scalar,
  district: scalar,
  address: scalar,
});

export const envelopeSchema = z
  .object({
    status: z
      .union([z.literal("0"), z.literal("1"), z.literal(0), z.literal(1)])
      .transform(String),
    infocode: z
      .union([z.string(), z.number()])
      .transform(String)
      .pipe(z.string().regex(/^\d{5}$/))
      .optional(),
  })
  .passthrough();

export const poisSchema = z.object({ pois: z.array(z.unknown()).max(1000) });
export const tipsSchema = z.object({ tips: z.array(z.unknown()).max(1000) });
export const geocodeSchema = z.object({
  regeocode: z.object({
    addressComponent: z.object({ citycode: scalar, adcode: scalar }),
  }),
});

export type AmapPoi = z.infer<typeof poiSchema>;
export type AmapTip = z.infer<typeof tipSchema>;

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
