import { open, seal } from "./crypto.js";
import { pool } from "./db.js";
import { configFrom, isStub, reviewResume } from "./llm.js";
import { providerHeaders } from "./provider.js";
import { sourceHash } from "./review.js";

export const textAad = (id: string) => `resumes.text:${id}`;
export const reviewAad = (id: string) => `resume_reviews.review:${id}`;

export class ReviewJobError extends Error {
    // A permanent one is acked instead of retried: nothing about it changes on a redelivery.
    readonly permanent: boolean;

    constructor(message: string, permanent = false) {
        super(message);
        this.permanent = permanent;
    }
}

export async function runReview(resumeId: string, userId: string, headers = new Headers()): Promise<void> {
    const found = (await pool.query("SELECT text FROM resumes WHERE id = $1 AND user_id = $2", [resumeId, userId])).rows[0] as { text: string } | undefined;
    if (found === undefined) throw new ReviewJobError("Resume not found", true);
    const text = open(found.text, textAad(resumeId));
    const config = configFrom(await providerHeaders(userId, headers));
    if (isStub(config)) throw new ReviewJobError("No scoring engine is configured on this deployment, so a review cannot run.", true);
    const got = await reviewResume(text, config);
    if (got === null) throw new ReviewJobError("The reviewer could not read this resume right now. Try again in a moment.");
    await pool.query(
        `INSERT INTO resume_reviews (resume_id, source_hash, review, status, error) VALUES ($1, $2, $3, 'done', NULL)
         ON CONFLICT (resume_id) DO UPDATE SET source_hash = EXCLUDED.source_hash, review = EXCLUDED.review, status = 'done', error = NULL, created_at = now()`,
        [resumeId, sourceHash(text), seal(JSON.stringify(got), reviewAad(resumeId))],
    );
}
