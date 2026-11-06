export const up = (pgm) => {
    pgm.sql("ALTER TABLE resumes DROP COLUMN IF EXISTS page_count;");
};

export const down = (pgm) => {
    pgm.sql("ALTER TABLE resumes ADD COLUMN IF NOT EXISTS page_count SMALLINT NOT NULL DEFAULT 0 CHECK (page_count >= 0);");
};
