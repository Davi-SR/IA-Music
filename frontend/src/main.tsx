import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomePage } from "./pages/HomePage";
import "./styles/styles.css";
import "./styles/navigation.css";
import "./styles/account.css";
import "./styles/youtube.css";
import "./styles/youtube-progress.css";
import "./styles/library.css";
import "./styles/auth.css";
import "./styles/react.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
