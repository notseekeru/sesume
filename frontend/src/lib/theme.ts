export type ThemePref = "system" | "light" | "dark";

const KEY = "sesume.theme";
const ORDER: ThemePref[] = ["system", "light", "dark"];
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme(): ThemePref {
    try {
        const raw = localStorage.getItem(KEY);
        return raw === "light" || raw === "dark" ? raw : "system";
    } catch {
        return "system";
    }
}

function resolved(pref: ThemePref): "light" | "dark" {
    return pref === "system" ? (darkQuery.matches ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePref): void {
    const theme = resolved(pref);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0E0E0E" : "#FFFFFF");
}

export function saveTheme(pref: ThemePref): void {
    applyTheme(pref);
    try {
        localStorage.setItem(KEY, pref);
    } catch {
        return;
    }
}

export function nextTheme(pref: ThemePref): ThemePref {
    return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
}

export function watchSystem(pref: ThemePref): () => void {
    const sync = () => {
        if (pref === "system") applyTheme("system");
    };
    darkQuery.addEventListener("change", sync);
    return () => darkQuery.removeEventListener("change", sync);
}

if (import.meta.env.DEV && (nextTheme("system") !== "light" || nextTheme("light") !== "dark" || nextTheme("dark") !== "system")) console.error("theme: self-check failed");
