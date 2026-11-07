import { Hono } from "hono";
import { pool } from "./db.js";
import routes from "./routes.js";

export const app = new Hono().basePath("/api");

const originToken = process.env.ORIGIN_TOKEN ?? "";

// The Function URL is public. The edge nginx is the only caller that carries this header, so a
// request that bypasses the edge never reaches the routes. Unset in local dev on purpose.
app.use("*", async (c, next) => {
    if (originToken !== "" && c.req.header("x-origin-token") !== originToken) return c.json({ detail: "Forbidden" }, 403);
    await next();
});

app.get("/healthz", async (c) => {
    try {
        await pool.query("SELECT 1");
        return c.json({ status: "ok" });
    } catch {
        return c.json({ status: "down" }, 503);
    }
});

app.route("/", routes);

const known = app.routes.filter((route) => route.method !== "ALL").map((route) => ({ method: route.method, test: new RegExp(`^${route.path.replace(/:[a-zA-Z]+/g, "[^/]+")}$`) }));

app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    const allowed = [...new Set(known.filter((route) => route.test.test(path)).map((route) => route.method))];
    if (allowed.length) return c.json({ detail: "Method not allowed" }, 405, { allow: allowed.join(", ") });
    return c.json({ detail: "Not found" }, 404);
});

export default app;
