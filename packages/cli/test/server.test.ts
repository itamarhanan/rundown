import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";
const get = (path: string, host: string) =>
  createApp().request(`http://${host}${path}`, { headers: { host } });
describe("createApp", () => {
  it.each(["evil.example.com", "evil.example.com:4477", "192.168.1.10:4477", "localhost.evil.com"])(
    "refuses Host %s with 403",
    async (host) => {
      const res = await get("/api/meta", host);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden host" });
    },
  );
  it("refuses non-API paths on foreign hosts too", async () => {
    expect((await get("/", "attacker.test")).status).toBe(403);
  });
  it.each(["localhost:4477", "127.0.0.1:4477", "[::1]:4477", "localhost"])(
    "404s unknown API routes on %s",
    async (host) => {
      const res = await get("/api/nope", host);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    },
  );
  it("404s unknown brief kinds", async () => {
    const res = await get("/api/brief/fortnight", "localhost:4477");
    expect(res.status).toBe(404);
  });
});
