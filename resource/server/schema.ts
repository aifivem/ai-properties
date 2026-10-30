import type { PanelSchema } from "@aicore-fivem/shared";

const int = (min: number, max: number) =>
  ({ type: "number", min, max, integer: true }) as const;

/** ai-properties' panel: properties for sale (door, interior, price), the interiors and the rules. */
export const propertiesSchema: PanelSchema = {
  title: "ADMIN_TITLE",
  icon: "building-columns",
  files: {
    settings: {
      kind: "settings",
      sync: "admin",
      sections: {
        account: { type: "text", lookup: "account", min: 2, max: 32 },
        sellPercent: int(0, 100),
        policeJobs: {
          type: "names",
          lookup: "job",
          max: 10,
          itemMax: 32,
          pattern: "^[a-z0-9_]{2,32}$",
        },
        policeEnter: { type: "bool" },
        stashSlots: int(1, 200),
        stashWeight: int(1000, 10_000_000),
      },
    },
    properties: {
      kind: "records",
      sync: "all",
      labelPath: "label",
      newRecord: {
        label: "",
        door: { x: 0, y: 0, z: 0, heading: 0 },
        interior: "low",
        price: 50000,
        blip: false,
      },
      sections: {
        label: { type: "text", min: 1, max: 48 },
        door: { type: "vec4" },
        interior: { type: "text", min: 1, max: 48 },
        price: int(0, 1_000_000_000),
        blip: { type: "bool" },
      },
    },
    interiors: {
      kind: "records",
      sync: "all",
      labelPath: "label",
      newRecord: { label: "", entry: { x: 0, y: 0, z: 0, heading: 0 } },
      sections: {
        label: { type: "text", min: 1, max: 48 },
        entry: { type: "vec4" },
      },
    },
  },
  tabs: [
    {
      id: "properties",
      file: "properties",
      icon: "building-columns",
      label: "ADMIN_TAB_PROPERTIES",
      desc: "ADMIN_TAB_PROPERTIES_DESC",
      listSub: "interior",
      createLabel: "ADMIN_NEW_PROPERTY",
      deleteLabel: "ADMIN_DELETE_PROPERTY",
      deleteDesc: "ADMIN_DELETE_PROPERTY_DESC",
      cards: [
        {
          icon: "building-columns",
          title: "ADMIN_C_PROPERTY",
          desc: "ADMIN_C_PROPERTY_DESC",
          fields: [
            {
              widget: "text",
              path: "label",
              suggest: { from: "door" },
              label: "ADMIN_F_LABEL",
              placeholder: "ADMIN_P_LABEL",
            },
            {
              widget: "point",
              path: "door",
              label: "ADMIN_F_DOOR",
              hint: "ADMIN_H_DOOR",
              heading: true,
              ground: true,
            },
            {
              widget: "text",
              path: "interior",
              label: "ADMIN_F_INTERIOR",
              hint: "ADMIN_H_INTERIOR",
              placeholder: "ADMIN_P_INTERIOR",
            },
            {
              widget: "number",
              path: "price",
              label: "ADMIN_F_PRICE",
              min: 0,
              max: 1_000_000_000,
              unit: "$",
            },
            {
              widget: "switch",
              path: "blip",
              label: "ADMIN_F_BLIP",
              hint: "ADMIN_H_BLIP",
            },
          ],
        },
      ],
    },
    {
      id: "interiors",
      file: "interiors",
      icon: "warehouse",
      label: "ADMIN_TAB_INTERIORS",
      desc: "ADMIN_TAB_INTERIORS_DESC",
      createLabel: "ADMIN_NEW_INTERIOR",
      deleteLabel: "ADMIN_DELETE_INTERIOR",
      deleteDesc: "ADMIN_DELETE_INTERIOR_DESC",
      cards: [
        {
          icon: "warehouse",
          title: "ADMIN_C_INTERIOR",
          desc: "ADMIN_C_INTERIOR_DESC",
          fields: [
            {
              widget: "text",
              path: "label",
              suggest: { from: "entry" },
              label: "ADMIN_F_LABEL",
              placeholder: "ADMIN_P_INTERIOR_LABEL",
            },
            {
              widget: "point",
              path: "entry",
              label: "ADMIN_F_ENTRY",
              hint: "ADMIN_H_ENTRY",
              heading: true,
              ground: true,
            },
          ],
        },
      ],
    },
    {
      id: "settings",
      file: "settings",
      icon: "sliders",
      label: "ADMIN_TAB_SETTINGS",
      desc: "ADMIN_TAB_SETTINGS_DESC",
      cards: [
        {
          icon: "sliders",
          title: "ADMIN_C_SETTINGS",
          desc: "ADMIN_C_SETTINGS_DESC",
          fields: [
            {
              widget: "text",
              lookup: "account",
              path: "account",
              label: "ADMIN_F_ACCOUNT",
              hint: "ADMIN_H_ACCOUNT",
              placeholder: "ADMIN_P_ACCOUNT",
            },
            {
              widget: "number",
              path: "sellPercent",
              label: "ADMIN_F_SELL",
              hint: "ADMIN_H_SELL",
              min: 0,
              max: 100,
              unit: "%",
            },
            {
              widget: "number",
              path: "stashSlots",
              label: "ADMIN_F_STASH_SLOTS",
              min: 1,
              max: 200,
            },
            {
              widget: "number",
              path: "stashWeight",
              label: "ADMIN_F_STASH_WEIGHT",
              hint: "ADMIN_H_STASH_WEIGHT",
              min: 1000,
              max: 10_000_000,
              unit: "g",
            },
            {
              widget: "switch",
              path: "policeEnter",
              label: "ADMIN_F_POLICE_ENTER",
              hint: "ADMIN_H_POLICE_ENTER",
            },
            {
              widget: "tags",
              lookup: "job",
              path: "policeJobs",
              label: "ADMIN_F_POLICE_JOBS",
              placeholder: "ADMIN_P_POLICE_JOBS",
            },
          ],
        },
      ],
    },
  ],
};
