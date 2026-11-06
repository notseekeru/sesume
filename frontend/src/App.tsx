import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { ApiError, me, setAccount } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import ResumePage from "./pages/ResumePage";

export default function App() {
    const [email, setEmail] = useState<string | null>(null);
    const [offline, setOffline] = useState(false);

    const check = useCallback(async () => {
        try {
            const account = await me();
            setAccount(account.email);
            setEmail(account.email);
            setOffline(false);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                setAccount(null);
                setEmail(null);
                setOffline(false);
                return;
            }
            setAccount("");
            setOffline(true);
        }
    }, []);

    useEffect(() => {
        void check();
    }, [check]);

    return (
        <Routes>
            <Route path="/" element={<ResumePage email={email} offline={offline} onRetry={() => void check()} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
