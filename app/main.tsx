import { createRoot } from "react-dom/client";
import Root from "./root";
import "./ui.css";
import "./globals.css";
import "./homepage.css";

createRoot(document.getElementById("root")!).render(<Root />);
