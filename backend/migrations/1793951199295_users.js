export const up = (pgm) => {
    pgm.sql(`
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 20 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS resumes_user_created_idx ON resumes (user_id, created_at DESC);
`);
};

export const down = (pgm) => {
    pgm.sql("DROP INDEX IF EXISTS resumes_user_created_idx; ALTER TABLE resumes DROP COLUMN IF EXISTS user_id; DROP TABLE IF EXISTS users;");
};
