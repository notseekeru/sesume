import { ready } from "./bootstrap.js";

export interface SqsEvent {
    Records: { messageId: string; body: string }[];
}

export interface SqsResult {
    batchItemFailures: { itemIdentifier: string }[];
}

export function jobOf(body: string): { resumeId: string; userId: string } | null {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed !== "object" || parsed === null) return null;
        const { resumeId, userId } = parsed as Record<string, unknown>;
        return typeof resumeId === "string" && typeof userId === "string" ? { resumeId, userId } : null;
    } catch {
        return null;
    }
}

export async function handler(event: SqsEvent): Promise<SqsResult> {
    await ready();
    const { pool } = await import("./db.js");
    const { runReview } = await import("./reviewJob.js");

    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
        const job = jobOf(record.body);
        if (job === null) {
            batchItemFailures.push({ itemIdentifier: record.messageId });
            continue;
        }
        try {
            await runReview(job.resumeId, job.userId);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Review failed.";
            await pool.query("UPDATE resume_reviews SET status = 'failed', error = $2 WHERE resume_id = $1", [job.resumeId, message.slice(0, 500)]).catch(() => undefined);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }
    return { batchItemFailures };
}
