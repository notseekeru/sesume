export const up = (pgm) => {
    pgm.sql(`
ALTER TABLE resume_reviews ALTER COLUMN review DROP NOT NULL;
ALTER TABLE resume_reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('queued', 'done', 'failed'));
ALTER TABLE resume_reviews ADD COLUMN error TEXT;
`);
};

export const down = (pgm) => {
    pgm.sql(`
DELETE FROM resume_reviews WHERE review IS NULL;
ALTER TABLE resume_reviews DROP COLUMN IF EXISTS status;
ALTER TABLE resume_reviews DROP COLUMN IF EXISTS error;
ALTER TABLE resume_reviews ALTER COLUMN review SET NOT NULL;
`);
};
