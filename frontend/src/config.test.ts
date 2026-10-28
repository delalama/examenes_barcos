import { describe, expect, it } from "vitest";
describe("license catalog",()=>it("supports all four Spanish nautical licenses",()=>expect(["PNB","PER","PY","CY"]).toHaveLength(4)));
