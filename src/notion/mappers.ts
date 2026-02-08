import { normalizeProperties } from "./properties.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function readPlainText(richText: unknown): string {
  if (!Array.isArray(richText)) {
    return "";
  }
  return richText
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const plainText = (item as { plain_text?: unknown }).plain_text;
      if (typeof plainText === "string") {
        return plainText;
      }
      const textContent = (item as { text?: { content?: unknown } }).text?.content;
      return typeof textContent === "string" ? textContent : "";
    })
    .join("");
}

function extractTitleFromProperties(properties: Record<string, unknown>): string {
  for (const property of Object.values(properties)) {
    if (!property || typeof property !== "object") {
      continue;
    }
    const record = property as Record<string, unknown>;
    if (record.type === "title") {
      return readPlainText(record.title);
    }
  }
  return "";
}

function normalizeParent(parent: unknown): Record<string, unknown> | null {
  if (!parent || typeof parent !== "object") {
    return null;
  }

  const record = parent as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  if (!type) {
    return { raw: record };
  }

  return {
    type,
    id: record[type] ?? null,
  };
}

export function toCompactPage(page: Record<string, unknown>, fields?: string[]): Record<string, unknown> {
  const properties = normalizeProperties(asRecord(page.properties));

  const record: Record<string, unknown> = {
    id: String(page.id ?? ""),
    title: extractTitleFromProperties(asRecord(page.properties)),
    url: page.url ?? null,
    created_time: page.created_time ?? null,
    last_edited_time: page.last_edited_time ?? null,
    archived: Boolean(page.archived),
    parent: normalizeParent(page.parent),
  };

  if (fields && fields.length > 0) {
    for (const field of fields) {
      record[field] = properties[field] ?? null;
    }
  }

  return record;
}

export function toFullPage(page: Record<string, unknown>): Record<string, unknown> {
  const rawProperties = asRecord(page.properties);
  const properties = normalizeProperties(rawProperties);
  const propertyTypes = Object.fromEntries(
    Object.entries(rawProperties).map(([name, value]) => {
      const type = value && typeof value === "object" ? (value as { type?: unknown }).type : null;
      return [name, typeof type === "string" ? type : null];
    }),
  );

  return {
    id: String(page.id ?? ""),
    title: extractTitleFromProperties(rawProperties),
    url: page.url ?? null,
    created_time: page.created_time ?? null,
    last_edited_time: page.last_edited_time ?? null,
    archived: Boolean(page.archived),
    parent: normalizeParent(page.parent),
    properties,
    property_types: propertyTypes,
  };
}

export function toCompactDataSource(dataSource: Record<string, unknown>): Record<string, unknown> {
  const properties = asRecord(dataSource.properties);
  return {
    id: String(dataSource.id ?? ""),
    name: readPlainText(dataSource.title),
    url: dataSource.url ?? null,
    created_time: dataSource.created_time ?? null,
    last_edited_time: dataSource.last_edited_time ?? null,
    parent: normalizeParent(dataSource.parent),
    property_count: Object.keys(properties).length,
  };
}

export function toFullDataSource(dataSource: Record<string, unknown>): Record<string, unknown> {
  const properties = asRecord(dataSource.properties);

  return {
    id: String(dataSource.id ?? ""),
    name: readPlainText(dataSource.title),
    url: dataSource.url ?? null,
    created_time: dataSource.created_time ?? null,
    last_edited_time: dataSource.last_edited_time ?? null,
    parent: normalizeParent(dataSource.parent),
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [name, toFullDataSourceProperty(value)]),
    ),
  };
}

function normalizeOptions(options: unknown): Array<{ id: string | null; name: string | null; color: string | null }> {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (!option || typeof option !== "object") {
        return { id: null, name: null, color: null };
      }
      const record = option as { id?: unknown; name?: unknown; color?: unknown };
      return {
        id: typeof record.id === "string" ? record.id : null,
        name: typeof record.name === "string" ? record.name : null,
        color: typeof record.color === "string" ? record.color : null,
      };
    })
    .filter((option) => option.id !== null || option.name !== null);
}

function normalizeStatusGroups(groups: unknown): Array<{ id: string | null; name: string | null; color: string | null }> {
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups
    .map((group) => {
      if (!group || typeof group !== "object") {
        return { id: null, name: null, color: null };
      }
      const record = group as { id?: unknown; name?: unknown; color?: unknown };
      return {
        id: typeof record.id === "string" ? record.id : null,
        name: typeof record.name === "string" ? record.name : null,
        color: typeof record.color === "string" ? record.color : null,
      };
    })
    .filter((group) => group.id !== null || group.name !== null);
}

function normalizePropertyConfig(type: string, config: unknown): unknown {
  if (!config || typeof config !== "object") {
    return config ?? null;
  }

  const record = config as Record<string, unknown>;
  switch (type) {
    case "select":
    case "multi_select":
      return {
        options: normalizeOptions(record.options),
      };
    case "status":
      return {
        options: normalizeOptions(record.options),
        groups: normalizeStatusGroups(record.groups),
      };
    case "relation":
      return {
        data_source_id:
          typeof record.data_source_id === "string"
            ? record.data_source_id
            : typeof record.database_id === "string"
              ? record.database_id
              : null,
        synced_property_id:
          typeof record.synced_property_id === "string" ? record.synced_property_id : null,
        synced_property_name:
          typeof record.synced_property_name === "string" ? record.synced_property_name : null,
      };
    case "rollup":
      return {
        relation_property_id:
          typeof record.relation_property_id === "string" ? record.relation_property_id : null,
        relation_property_name:
          typeof record.relation_property_name === "string" ? record.relation_property_name : null,
        rollup_property_id:
          typeof record.rollup_property_id === "string" ? record.rollup_property_id : null,
        rollup_property_name:
          typeof record.rollup_property_name === "string" ? record.rollup_property_name : null,
        function: typeof record.function === "string" ? record.function : null,
      };
    case "formula":
      return {
        expression: typeof record.expression === "string" ? record.expression : null,
      };
    default:
      return record;
  }
}

function toFullDataSourceProperty(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { type: "unknown", id: "", config: null };
  }

  const property = value as Record<string, unknown>;
  const type = typeof property.type === "string" ? property.type : "unknown";
  const id = typeof property.id === "string" ? property.id : "";
  const config = type !== "unknown" ? normalizePropertyConfig(type, property[type]) : null;

  return {
    id,
    type,
    config,
  };
}

function extractTitleFromSearchObject(item: Record<string, unknown>): string {
  const object = item.object;
  if (object === "data_source") {
    return readPlainText(item.title);
  }

  if (object === "page") {
    return extractTitleFromProperties(asRecord(item.properties));
  }

  return "";
}

export function toSearchResult(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(item.id ?? ""),
    object: item.object ?? null,
    title: extractTitleFromSearchObject(item),
    url: item.url ?? null,
    last_edited_time: item.last_edited_time ?? null,
    parent: normalizeParent(item.parent),
  };
}
