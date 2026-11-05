import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Health = "checking" | "ok" | "unreachable";

export default function Home() {
    const [health, setHealth] = useState<Health>("checking");

    useEffect(() => {
        fetch("/api/healthz")
            .then((res) => res.json())
            .then((body: { status?: string }) => setHealth(body.status === "ok" ? "ok" : "unreachable"))
            .catch(() => setHealth("unreachable"));
    }, []);

    return (
        <main>
            <h1>sesume</h1>
            <p>api: {health}</p>
            <p>
                <Link to="/resume">Resume</Link>
            </p>
            <p>
                <Link to="/missing">404 route</Link>
            </p>
        </main>
    );
}
