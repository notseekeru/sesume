import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, login, register } from "../lib/api";

export default function LoginPage() {
    const [creating, setCreating] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();

    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await (creating ? register(email, password) : login(email, password));
            navigate("/", { replace: true });
        } catch (problem) {
            setError(problem instanceof ApiError ? problem.message : "Could not reach the server.");
            setBusy(false);
        }
    }

    return (
        <main className="auth">
            <form className="auth-card" onSubmit={(event) => void submit(event)}>
                <label className="hint" htmlFor="email">
                    Email
                </label>
                <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                <label className="hint" htmlFor="password">
                    Password
                </label>
                <input id="password" className="field" type="password" autoComplete={creating ? "new-password" : "current-password"} required minLength={creating ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} />
                {error && (
                    <p className="alert" role="alert">
                        {error}
                    </p>
                )}
                <button type="submit" className="btn primary" disabled={busy}>
                    {creating ? "Create account" : "Sign in"}
                </button>
                <button
                    type="button"
                    className="btn link"
                    onClick={() => {
                        setCreating(!creating);
                        setError(null);
                    }}
                >
                    {creating ? "I already have an account" : "Create an account"}
                </button>
            </form>
        </main>
    );
}
