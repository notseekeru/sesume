export const up = (pgm) => {
    pgm.sql(`
CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 60000),
    page_count SMALLINT NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resumes_created_idx ON resumes (created_at DESC);

CREATE TABLE IF NOT EXISTS resume_reviews (
    resume_id UUID PRIMARY KEY REFERENCES resumes(id) ON DELETE CASCADE,
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
    review JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
};

export const down = (pgm) => {
    pgm.sql("DROP TABLE IF EXISTS resume_reviews; DROP TABLE IF EXISTS resumes;");
};
