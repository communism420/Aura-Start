import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
