import { CliError } from "../errors/cli-error.js";

function readPlainText(rich: Array<Record<string, unknown>> | undefined): string {
  if (!rich || rich.length === 0) {
    return "";
  }

  return rich
    .map((fragment) => {
      const plainText = fragment.plain_text;
      if (typeof plainText === "string") {
        return plainText;
      }

      const text = fragment.text as { content?: string } | undefined;
      return text?.content ?? "";
    })
    .join("");
}

function normalizeFormula(formula: Record<string, unknown>): unknown {
  const type = formula.type;
  if (typeof type !== "string") {
    return formula;
  }
  return formula[type];
}

function normalizeRollup(rollup: Record<string, unknown>): unknown {
  const type = rollup.type;
  if (typeof type !== "string") {
    return rollup;
  }
  if (type === "array") {
    const arrayValue = rollup.array;
    if (!Array.isArray(arrayValue)) {
      return [];
    }
    return arrayValue.map((entry) => normalizePropertyValue(entry as Record<string, unknown>));
  }
  return rollup[type];
}

export function normalizePropertyValue(property: Record<string, unknown>): unknown {
  const type = property.type;
  if (typeof type !== "string") {
    return property;
  }

  switch (type) {
    case "title": {
      const title = property.title as Array<Record<string, unknown>> | undefined;
      return readPlainText(title);
    }
    case "rich_text": {
      const richText = property.rich_text as Array<Record<string, unknown>> | undefined;
      return readPlainText(richText);
    }
    case "status": {
      const status = property.status as { name?: string } | null | undefined;
      return status?.name ?? null;
    }
    case "select": {
      const select = property.select as { name?: string } | null | undefined;
      return select?.name ?? null;
    }
    case "multi_select": {
      const selections = property.multi_select as Array<{ name?: string }> | undefined;
      return selections?.map((item) => item.name).filter((value): value is string => Boolean(value)) ?? [];
    }
    case "date": {
      const date = property.date as { start?: string; end?: string | null; time_zone?: string | null } | null;
      return date;
    }
    case "relation": {
      const relation = property.relation as Array<{ id?: string }> | undefined;
      return relation?.map((entry) => entry.id).filter((value): value is string => Boolean(value)) ?? [];
    }
    case "people": {
      const people = property.people as Array<{ id?: string }> | undefined;
      return people?.map((person) => person.id).filter((value): value is string => Boolean(value)) ?? [];
    }
    case "checkbox":
    case "number":
    case "url":
    case "email":
    case "phone_number":
      return property[type] ?? null;
    case "files": {
      const files = property.files as Array<{
        name?: string;
        type?: string;
        external?: { url?: string };
        file?: { url?: string };
      }>;
      return (files ?? []).map((file) => ({
        name: file.name ?? null,
        type: file.type ?? null,
        url: file.type === "external" ? file.external?.url ?? null : file.file?.url ?? null,
      }));
    }
    case "formula": {
      const formula = property.formula as Record<string, unknown>;
      return normalizeFormula(formula);
    }
    case "rollup": {
      const rollup = property.rollup as Record<string, unknown>;
      return normalizeRollup(rollup);
    }
    case "created_time":
    case "last_edited_time":
      return property[type] ?? null;
    default:
      return property[type] ?? null;
  }
}

export function normalizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) {
    if (property && typeof property === "object") {
      normalized[name] = normalizePropertyValue(property as Record<string, unknown>);
    }
  }
  return normalized;
}

function normalizeDateInput(value: unknown): { start: string; end?: string | null; time_zone?: string | null } | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return { start: value };
  }

  if (value && typeof value === "object") {
    const candidate = value as { start?: unknown; end?: unknown; time_zone?: unknown };
    if (typeof candidate.start !== "string") {
      throw new CliError("invalid_input", "Date value must include a string \"start\" field.");
    }
    return {
      start: candidate.start,
      end: typeof candidate.end === "string" || candidate.end === null ? candidate.end : undefined,
      time_zone:
        typeof candidate.time_zone === "string" || candidate.time_zone === null
          ? candidate.time_zone
          : undefined,
    };
  }

  throw new CliError("invalid_input", "Invalid date value.");
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new CliError("invalid_input", `${label} expects an array of strings.`);
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (items.length !== value.length) {
    throw new CliError("invalid_input", `${label} expects an array of strings.`);
  }
  return items;
}

function toRichText(content: string): Array<{ type: "text"; text: { content: string } }> {
  return [{ type: "text", text: { content } }];
}

function isRawPropertyPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value as Record<string, unknown>);
  const known = new Set([
    "title",
    "rich_text",
    "status",
    "select",
    "multi_select",
    "date",
    "relation",
    "people",
    "checkbox",
    "number",
    "url",
    "email",
    "phone_number",
    "files",
    "formula",
  ]);

  return keys.some((key) => known.has(key));
}

export function buildPropertyValueByType(type: string, value: unknown): Record<string, unknown> {
  switch (type) {
    case "title": {
      if (typeof value !== "string") {
        throw new CliError("invalid_input", "Title properties require string values.");
      }
      return { title: toRichText(value) };
    }
    case "rich_text": {
      if (typeof value !== "string") {
        throw new CliError("invalid_input", "Rich text properties require string values.");
      }
      return { rich_text: toRichText(value) };
    }
    case "status": {
      if (typeof value !== "string") {
        throw new CliError("invalid_input", "Status properties require a string status name.");
      }
      return { status: { name: value } };
    }
    case "select": {
      if (typeof value !== "string") {
        throw new CliError("invalid_input", "Select properties require a string option name.");
      }
      return { select: { name: value } };
    }
    case "multi_select": {
      const names = asStringArray(value, "multi_select");
      return { multi_select: names.map((name) => ({ name })) };
    }
    case "date": {
      const normalized = normalizeDateInput(value);
      return { date: normalized };
    }
    case "relation": {
      const ids = asStringArray(value, "relation");
      return { relation: ids.map((id) => ({ id })) };
    }
    case "people": {
      const ids = asStringArray(value, "people");
      return { people: ids.map((id) => ({ id })) };
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new CliError("invalid_input", "Checkbox properties require boolean values.");
      }
      return { checkbox: value };
    }
    case "number": {
      if (typeof value !== "number") {
        throw new CliError("invalid_input", "Number properties require numeric values.");
      }
      return { number: value };
    }
    case "url": {
      if (typeof value !== "string" && value !== null) {
        throw new CliError("invalid_input", "URL properties require string or null values.");
      }
      return { url: value };
    }
    case "email": {
      if (typeof value !== "string" && value !== null) {
        throw new CliError("invalid_input", "Email properties require string or null values.");
      }
      return { email: value };
    }
    case "phone_number": {
      if (typeof value !== "string" && value !== null) {
        throw new CliError("invalid_input", "Phone number properties require string or null values.");
      }
      return { phone_number: value };
    }
    default: {
      if (typeof value === "string") {
        return { rich_text: toRichText(value) };
      }
      return { rich_text: toRichText(JSON.stringify(value)) };
    }
  }
}

export function buildPropertiesPayloadGeneric(
  patch: Record<string, unknown>,
  schemaProperties: Record<string, { id: string; type: string }>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [propertyName, value] of Object.entries(patch)) {
    const schemaEntry = schemaProperties[propertyName];
    if (!schemaEntry) {
      throw new CliError(
        "invalid_input",
        `Unknown property \"${propertyName}\" for this data source. Use data-sources get to inspect available properties.`,
      );
    }

    if (isRawPropertyPayload(value)) {
      payload[propertyName] = value;
      continue;
    }

    payload[propertyName] = buildPropertyValueByType(schemaEntry.type, value);
  }

  return payload;
}
