import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { ApiError, me } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import ResumePage from "./pages/ResumePage";

type Gate = { state: "checking" } | { state: "in"; email: string } | { state: "out" };

function Studio() {
    const [gate, setGate] = useState<Gate>({ state: "checking" });

    useEffect(() => {
        me().then(
            (account) => setGate({ state: "in", email: account.email }),
            (error: unknown) => setGate(error instanceof ApiError && error.status === 401 ? { state: "out" } : { state: "in", email: "" }),
        );
    }, []);

    if (gate.state === "checking") return null;
    if (gate.state === "out") return <LoginPage />;
    return <ResumePage email={gate.email} />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Studio />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
