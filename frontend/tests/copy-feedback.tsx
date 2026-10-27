// Synthetic component-only review. No real clipboard, engine, audio or project access.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CopyProblem } from '../src/components/CopyProblem';
import { ProcessNotice } from '../src/components/ProcessNotice';
import { recordProblem } from '../src/lib/diagnostics';
import { LANGUAGE_OPTIONS, setInterfaceLanguage, useInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import '../src/styles.css';

const problem = recordProblem('transcription', new Error('synthetic failure'));
let denyClipboard = false;
Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
  async writeText() { if (denyClipboard) throw new Error('synthetic clipboard denied'); },
}});

export function Review() {
  const [visible, setVisible] = useState(true);
  const language = useInterfaceLanguage();
  return <main className="app-shell" style={{padding: 24, width: '100%', boxSizing: 'border-box'}}>
    <h1>Copy feedback — synthetic review</h1>
    <label>Language <select aria-label="Review language" value={language} onChange={e => void setInterfaceLanguage(e.target.value as InterfaceLanguage)}>
      {LANGUAGE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label><input type="checkbox" onChange={e => { denyClipboard = e.target.checked; }} /> Simulate clipboard failure</label>
    {visible && <ProcessNotice card compact status="error" text="Synthetic transcription failure" phase="processing" ratio={0} hint="Synthetic recovery advice" raw="" engine="Synthetic engine" onDismiss={() => setVisible(false)} cancelTranscription={() => {}} setTranscriptionDialogOpen={() => {}} setSaveToast={() => {}} />}
    <div className="settings-body" style={{marginTop: 24}}><CopyProblem problem={problem} iconOnly /></div>
  </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Review />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
