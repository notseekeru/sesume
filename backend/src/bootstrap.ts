import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";

const prefix = process.env.SSM_PREFIX ?? "";

const envNames: Record<string, string> = {
    database_url: "DATABASE_URL",
    auth_secret: "AUTH_SECRET",
    data_key: "DATA_KEY",
    origin_token: "ORIGIN_TOKEN",
    llm_base_url: "LLM_BASE_URL",
    llm_model: "LLM_MODEL",
    llm_api_key: "LLM_API_KEY",
};

let loaded: Promise<void> | null = null;

// AI HERE: values land in process.env because db.ts and crypto.ts read them at import, so a
// handler has to await ready() before importing either. Ceiling: one SSM round trip per cold
// start. Upgrade path: read the parameters into a cached object and pass it explicitly.
export function ready(): Promise<void> {
    if (prefix === "") return Promise.resolve();
    loaded ??= load();
    return loaded;
}

async function load(): Promise<void> {
    const names = Object.keys(envNames).map((key) => `${prefix}/${key}`);
    const out = await new SSMClient({}).send(new GetParametersCommand({ Names: names, WithDecryption: true }));
    for (const parameter of out.Parameters ?? []) {
        const key = parameter.Name?.slice(prefix.length + 1) ?? "";
        const target = envNames[key];
        if (target !== undefined && parameter.Value !== undefined) process.env[target] = parameter.Value;
    }
    for (const [key, target] of Object.entries(envNames)) {
        if (process.env[target] === undefined) throw new Error(`${prefix}/${key} is missing from SSM`);
    }
}
