import { BLIP_STYLE_FIELDS } from "@aifivem/lib/shared";

export const blip = {
  type: "object",
  optional: true,
  fields: BLIP_STYLE_FIELDS,
} as const;
