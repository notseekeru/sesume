export const up = (pgm) => {
    pgm.sql(`
CREATE TABLE IF NOT EXISTS provider_configs (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
};

export const down = (pgm) => {
    pgm.sql("DROP TABLE IF EXISTS provider_configs;");
};
