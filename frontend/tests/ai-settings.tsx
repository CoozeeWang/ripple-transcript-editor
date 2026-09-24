// Settings layout fixture connected to the real local API; no transcript is loaded.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "../src/components/SettingsModal";
import "../src/styles.css";

export function SettingsPreview() {
  const [tab, setTab] = useState<"prefs" | "engines" | "ai" | "plans" | "diagnostics">("ai");
  const ref = useRef<HTMLDialogElement>(null);
  const noop = () => {};
  return <SettingsModal settingsTab={tab} setSettingsTab={setTab} settingsRef={ref}
    setSettingsOpen={noop} defaultPlaybackRate={1} setDefaultPlaybackRate={noop}
    setPlaybackRate={noop} audioRef={{ current: null }} skipSeconds={3} setSkipSeconds={noop} />;
}
createRoot(document.getElementById("root")!).render(<SettingsPreview />);
