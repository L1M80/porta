import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PORTA_BASE_PATH } from "./basePath";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={PORTA_BASE_PATH}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
