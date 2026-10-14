import { installFileDropGuard } from "./lib/fileDropGuard";
import { installRuntimeDiagnostics } from "./lib/diagnostics";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import { AIConnectorProvider } from './components/AIConnectorProvider';
import { installEditorCompositionTracking } from './lib/editorDrafts';
import { installDesktopRuntime } from "./lib/desktopRuntime";
import "./styles.css";

const removeFileDropGuard = installFileDropGuard();
const removeCompositionTracking = installEditorCompositionTracking();
if (import.meta.hot) import.meta.hot.dispose(removeCompositionTracking);
if (import.meta.hot) import.meta.hot.dispose(removeFileDropGuard);

const removeDiagnostics = installRuntimeDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(removeDiagnostics);

const root = createRoot(document.getElementById("root")!);
void installDesktopRuntime().then(() => root.render(
  <StrictMode><AIConnectorProvider><ProjectWorkspace /></AIConnectorProvider></StrictMode>,
)).catch(error => root.render(<main style={{ padding: 32 }} role="alert">{String(error)}</main>));
