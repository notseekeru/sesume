import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { me, setAccount } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import ResumePage from "./pages/ResumePage";

export default function App() {
    const [email, setEmail] = useState<string | null>(null);

    useEffect(() => {
        me().then(
            (account) => {
                setEmail(account.email);
                setAccount(account.email);
            },
            () => {
                setEmail(null);
                setAccount("");
            },
        );
    }, []);

    return (
        <Routes>
            <Route path="/" element={<ResumePage email={email} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
