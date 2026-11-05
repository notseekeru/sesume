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
    page_count: number;
    chars: number;
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

export const listResumes = () => request<ResumeSummary[]>("/resumes");

export const getResume = (id: string) => request<Resume>(`/resumes/${id}`);

export async function extractResume(file: File): Promise<ResumeExtract> {
    const form = new FormData();
    form.append("file", file);
    return request<ResumeExtract>("/resumes/extract", { method: "POST", body: form });
}

export const createResume = (input: { name: string; text: string }) => request<Resume>("/resumes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });

export const updateResume = (id: string, input: { name: string; text: string }) => request<Resume>(`/resumes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });

export const deleteResume = (id: string) => request<void>(`/resumes/${id}`, { method: "DELETE" });

export const getResumeReview = (id: string) => request<ResumeReview | null>(`/resumes/${id}/review`);

export const reviewResume = (id: string) => request<ResumeReview>(`/resumes/${id}/review`, { method: "POST", headers: llmHeaders() });

export const retryRewrite = (id: string, source: string) => request<ResumeReview>(`/resumes/${id}/review/rewrite`, { method: "POST", headers: { "content-type": "application/json", ...llmHeaders() }, body: JSON.stringify({ source }) });

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
