export const up = (pgm) => {
    pgm.sql(`
ALTER TABLE resumes DROP CONSTRAINT IF EXISTS resumes_text_check;
ALTER TABLE resume_reviews ALTER COLUMN review TYPE TEXT USING review::text;
`);
};

// AI HERE: irreversible. Ciphertext no longer fits the old column type or the 60000 length cap, so the
// down would fail on the first encrypted row. Restore a dump instead.
export const down = () => {};
