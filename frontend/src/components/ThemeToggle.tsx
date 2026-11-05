import { useEffect, useState } from "react";
import { loadTheme, nextTheme, saveTheme, type ThemePref, watchSystem } from "../lib/theme";

const LABEL: Record<ThemePref, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeToggle() {
    const [pref, setPref] = useState<ThemePref>(loadTheme);
    useEffect(() => watchSystem(pref), [pref]);

    const label = LABEL[pref];
    const next = nextTheme(pref);

    return (
        <button
            type="button"
            className="btn theme"
            aria-label={`Theme: ${label}. Switch to ${LABEL[next]}.`}
            title={`Theme: ${label}`}
            onClick={() => {
                saveTheme(next);
                setPref(next);
            }}
        >
            <span className={`theme-dot ${pref === "system" ? "auto" : pref}`} aria-hidden />
            <span className="theme-label">{label}</span>
        </button>
    );
}
