import { Route, Routes } from "react-router-dom";
import NotFound from "./pages/NotFound";
import ResumePage from "./pages/ResumePage";

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<ResumePage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
