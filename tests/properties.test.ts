import { describe, expect, it } from "vitest";
import { buildPropertiesPayloadGeneric, normalizePropertyValue } from "../src/notion/properties.js";

describe("notion property mapping", () => {
  it("normalizes relation values into ID lists", () => {
    const relationProperty = {
      type: "relation",
      relation: [{ id: "p1" }, { id: "p2" }],
    };

    expect(normalizePropertyValue(relationProperty)).toEqual(["p1", "p2"]);
  });

  it("builds typed payloads from schema-backed generic patch values", () => {
    const payload = buildPropertiesPayloadGeneric(
      {
        Name: "Ship CLI",
        Status: "In Progress",
        Project: ["abc123"],
      },
      {
        Name: { id: "title", type: "title" },
        Status: { id: "status", type: "status" },
        Project: { id: "relation", type: "relation" },
      },
    );

    expect(payload).toEqual({
      Name: {
        title: [{ type: "text", text: { content: "Ship CLI" } }],
      },
      Status: {
        status: { name: "In Progress" },
      },
      Project: {
        relation: [{ id: "abc123" }],
      },
    });
  });
});
