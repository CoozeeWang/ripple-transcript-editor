import { installRuntimeDiagnostics } from "./lib/diagnostics";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import { installDesktopRuntime } from "./lib/desktopRuntime";
import "./styles.css";

const removeDiagnostics = installRuntimeDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(removeDiagnostics);

const root = createRoot(document.getElementById("root")!);
void installDesktopRuntime().then(() => root.render(
  <StrictMode><ProjectWorkspace /></StrictMode>,
)).catch(error => root.render(<main style={{ padding: 32 }} role="alert">{String(error)}</main>));
