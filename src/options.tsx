import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import "./styles.css";

createRoot(document.getElementById("options-root") as HTMLElement).render(<App initialSettingsOpen />);
