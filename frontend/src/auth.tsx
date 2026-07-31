import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthPage } from "./pages/AuthPage";
import "./styles/styles.css";
import "./styles/navigation.css";
import "./styles/account.css";
import "./styles/auth.css";
import "./styles/react.css";


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthPage />
  </StrictMode>,
);

