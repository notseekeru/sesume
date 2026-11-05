import { Hono } from "hono";
import routes from "./routes.js";

export const app = new Hono().basePath("/api");

app.get("/healthz", (c) => c.json({ status: "ok" }));
app.route("/", routes);

export default app;
