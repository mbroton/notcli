import { describe, expect, it } from "vitest";
import { toFullDataSource } from "../src/notion/mappers.js";

describe("toFullDataSource", () => {
  it("includes rich config metadata for schema-driven agents", () => {
    const dataSource = {
      object: "data_source",
      id: "ds-1",
      title: [{ plain_text: "Tasks" }],
      properties: {
        Status: {
          id: "st",
          type: "status",
          status: {
            options: [{ id: "s1", name: "Todo", color: "gray" }],
            groups: [{ id: "g1", name: "Backlog", color: "gray" }],
          },
        },
        Priority: {
          id: "pr",
          type: "select",
          select: {
            options: [{ id: "p1", name: "High", color: "red" }],
          },
        },
        Project: {
          id: "rel",
          type: "relation",
          relation: {
            data_source_id: "projects-ds",
          },
        },
      },
    } as Record<string, unknown>;

    const full = toFullDataSource(dataSource);
    const properties = full.properties as Record<string, unknown>;

    expect((properties.Status as { config?: unknown }).config).toEqual({
      options: [{ id: "s1", name: "Todo", color: "gray" }],
      groups: [{ id: "g1", name: "Backlog", color: "gray" }],
    });

    expect((properties.Priority as { config?: unknown }).config).toEqual({
      options: [{ id: "p1", name: "High", color: "red" }],
    });

    expect((properties.Project as { config?: unknown }).config).toEqual({
      data_source_id: "projects-ds",
      synced_property_id: null,
      synced_property_name: null,
    });
  });
});
