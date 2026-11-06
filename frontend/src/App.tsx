import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { ApiError, me, setAccount } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import ResumePage from "./pages/ResumePage";

type Boot = { state: "loading" } | { state: "down" } | { state: "ready"; email: string | null };

export default function App() {
    const [boot, setBoot] = useState<Boot>({ state: "loading" });

    const check = useCallback(() => {
        setBoot({ state: "loading" });
        void me().then(
            (account) => {
                setAccount(account.email);
                setBoot({ state: "ready", email: account.email });
            },
            (error: unknown) => {
                if (!(error instanceof ApiError && error.status === 401)) {
                    setBoot({ state: "down" });
                    return;
                }
                setAccount(null);
                setBoot({ state: "ready", email: null });
            },
        );
    }, []);

    useEffect(check, [check]);

    if (boot.state === "loading") return null;
    if (boot.state === "down")
        return (
            <main className="welcome">
                <div className="welcome-card">
                    <p className="hint">Cannot reach the server. Nothing saved has been lost.</p>
                    <button type="button" className="btn" onClick={check}>
                        Retry
                    </button>
                </div>
            </main>
        );

    return (
        <Routes>
            <Route path="/" element={<ResumePage email={boot.email} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
