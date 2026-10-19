import { UpdateWindow } from "./components/UpdateWindow";
import { isDesktopUpdateWindow } from "./lib/desktopUpdates";
import { setInterfaceLanguage } from "./i18n";
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
if (isDesktopUpdateWindow()) {
  document.documentElement.classList.add('desktop-update-document');
  const language=(window as unknown as {__RIPPLE_UPDATE_WINDOW__:{language:string}}).__RIPPLE_UPDATE_WINDOW__.language;
  void setInterfaceLanguage(language==='en'?'en':'zh-CN').then(()=>root.render(<StrictMode><UpdateWindow /></StrictMode>));
} else void installDesktopRuntime().then(() => root.render(
  <StrictMode><AIConnectorProvider><ProjectWorkspace /></AIConnectorProvider></StrictMode>,
)).catch(error => root.render(<main style={{ padding: 32 }} role="alert">{String(error)}</main>));
