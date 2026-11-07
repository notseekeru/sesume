import { fileURLToPath } from "node:url";
import { ready } from "./bootstrap.js";

export async function handler(): Promise<void> {
    await ready();
    const { runner } = await import("node-pg-migrate");
    await runner({
        databaseUrl: process.env.DATABASE_URL ?? "",
        dir: fileURLToPath(new URL("../migrations/", import.meta.url)),
        direction: "up",
        migrationsTable: "pgmigrations",
        count: Number.POSITIVE_INFINITY,
    });
}
