const BASE = "/api";

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${BASE}${path}`, init);
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : `Request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
}

export interface Account {
    email: string;
}

export const me = () => request<Account>("/auth/me");
export const logout = () => request<void>("/auth/logout", { method: "POST" });

// AI HERE: resumes move to the account, the reviews written for them do not: the server only stores a
// review it generated itself. Ceiling: a guest's review is dropped at the first sign-in. Upgrade path: an
// endpoint that accepts a client-held review once it can be tied to the text it graded.
async function adoptLocal(): Promise<void> {
    for (const row of localRead()) {
        try {
            await request<Resume>("/resumes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: row.name, text: row.text }) });
        } catch {
            continue;
        }
        localWrite(localRead().filter((item) => item.id !== row.id));
    }
}

export async function login(email: string, password: string): Promise<Account> {
    const account = await request<Account>("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    await adoptLocal();
    return account;
}

export async function register(email: string, password: string): Promise<Account> {
    const account = await request<Account>("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    await adoptLocal();
    return account;
}

export interface Provider {
    baseUrl: string;
    model: string;
    key: string;
}

const PROVIDER_KEY = "sesume.provider";

export function loadProvider(): Provider {
    try {
        const raw = sessionStorage.getItem(PROVIDER_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<Provider>) : {};
        return { baseUrl: parsed.baseUrl ?? "", model: parsed.model ?? "", key: parsed.key ?? "" };
    } catch {
        return { baseUrl: "", model: "", key: "" };
    }
}

export function saveProvider(provider: Provider): void {
    try {
        sessionStorage.setItem(PROVIDER_KEY, JSON.stringify(provider));
    } catch {
        return;
    }
}

function llmHeaders(): Record<string, string> {
    const provider = loadProvider();
    return {
        ...(provider.baseUrl.trim() ? { "x-llm-base-url": provider.baseUrl.trim() } : {}),
        ...(provider.model.trim() ? { "x-llm-model": provider.model.trim() } : {}),
        ...(provider.key.trim() ? { "x-llm-key": provider.key.trim() } : {}),
    };
}

export interface ResumeSummary {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
}

export interface Resume extends ResumeSummary {
    text: string;
}

export interface ResumeExtract {
    text: string;
    pages: number;
    truncated: boolean;
}

export interface ReviewLevel {
    level: string;
    call: string;
    thinks: string;
    move: string;
}

export interface ReviewSection {
    name: string;
    call: string;
    note: string;
}

export interface ReviewRewrite {
    source: string;
    rewrite: string;
}

export interface ReviewLine {
    text: string;
    call: "weak" | "safe" | "strong";
}

export interface ResumeReview {
    verdict: string;
    levels: ReviewLevel[];
    sections: ReviewSection[];
    rewrites: ReviewRewrite[];
    lines: ReviewLine[];
    reads_at: string | null;
    stale: boolean;
    created_at: string;
}

let account: boolean | null = null;
let settle: (value: boolean) => void = () => undefined;
const sessionReady = new Promise<boolean>((resolve) => {
    settle = resolve;
});

export function setAccount(email: string | null): void {
    account = email !== null;
    settle(account);
}

const signedIn = () => (account === null ? sessionReady : Promise.resolve(account));

interface LocalResume {
    id: string;
    name: string;
    text: string;
    reviewed: string | null;
    review: ResumeReview | null;
    created_at: string;
    updated_at: string;
}

const LOCAL_KEY = "sesume.resumes";

function localRead(): LocalResume[] {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(parsed) ? (parsed as LocalResume[]) : [];
    } catch {
        return [];
    }
}

function localWrite(rows: LocalResume[]): void {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
}

function localFind(id: string): LocalResume {
    const row = localRead().find((item) => item.id === id);
    if (!row) throw new ApiError(404, "Resume not found");
    return row;
}

function localSummary(row: LocalResume): ResumeSummary {
    return { id: row.id, name: row.name, created_at: row.created_at, updated_at: row.updated_at };
}

function localResume(row: LocalResume): Resume {
    return { ...localSummary(row), text: row.text };
}

function localSave(row: LocalResume): Resume {
    const rows = localRead();
    localWrite(rows.some((item) => item.id === row.id) ? rows.map((item) => (item.id === row.id ? row : item)) : [row, ...rows]);
    return localResume(row);
}

function uid(): string {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listResumes(): Promise<ResumeSummary[]> {
    if (await signedIn()) return request<ResumeSummary[]>("/resumes");
    return localRead().map(localSummary);
}

export async function getResume(id: string): Promise<Resume> {
    if (await signedIn()) return request<Resume>(`/resumes/${id}`);
    return localResume(localFind(id));
}

export async function extractResume(file: File): Promise<ResumeExtract> {
    const form = new FormData();
    form.append("file", file);
    return request<ResumeExtract>("/resumes/extract", { method: "POST", body: form });
}

export async function createResume(input: { name: string; text: string }): Promise<Resume> {
    if (await signedIn()) return request<Resume>("/resumes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const now = new Date().toISOString();
    return localSave({ id: uid(), name: input.name, text: input.text, reviewed: null, review: null, created_at: now, updated_at: now });
}

export async function updateResume(id: string, input: { name: string; text: string }): Promise<Resume> {
    if (await signedIn()) return request<Resume>(`/resumes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    return localSave({ ...localFind(id), name: input.name, text: input.text, updated_at: new Date().toISOString() });
}

export async function deleteResume(id: string): Promise<void> {
    if (await signedIn()) return request<void>(`/resumes/${id}`, { method: "DELETE" });
    localWrite(localRead().filter((item) => item.id !== id));
}

export async function getResumeReview(id: string): Promise<ResumeReview | null> {
    if (await signedIn()) return request<ResumeReview | null>(`/resumes/${id}/review`);
    const row = localFind(id);
    return row.review === null ? null : { ...row.review, stale: row.reviewed !== row.text };
}

export async function reviewResume(id: string): Promise<ResumeReview> {
    if (await signedIn()) return request<ResumeReview>(`/resumes/${id}/review`, { method: "POST", headers: llmHeaders() });
    const row = localFind(id);
    const review = await request<ResumeReview>("/review", { method: "POST", headers: { "content-type": "application/json", ...llmHeaders() }, body: JSON.stringify({ text: row.text }) });
    localSave({ ...row, review, reviewed: row.text });
    return review;
}

export async function retryRewrite(id: string, source: string): Promise<ResumeReview> {
    if (await signedIn()) return request<ResumeReview>(`/resumes/${id}/review/rewrite`, { method: "POST", headers: { "content-type": "application/json", ...llmHeaders() }, body: JSON.stringify({ source }) });
    const row = localFind(id);
    if (row.review === null) throw new ApiError(409, "Review this resume first: there is no edit to retry.");
    const got = await request<ReviewRewrite>("/review/rewrite", { method: "POST", headers: { "content-type": "application/json", ...llmHeaders() }, body: JSON.stringify({ text: row.text, source }) });
    const review = { ...row.review, rewrites: [got, ...row.review.rewrites.filter((item) => item.source !== source)] };
    localSave({ ...row, review });
    return review;
}

export async function compileLatex(text: string): Promise<Blob> {
    const response = await fetch(`${BASE}/resumes/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new ApiError(response.status, typeof body?.detail === "string" ? body.detail : "Could not compile this document.");
    }
    return response.blob();
}
