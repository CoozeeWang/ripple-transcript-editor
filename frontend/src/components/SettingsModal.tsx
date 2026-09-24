import { msg, useInterfaceLanguage, setInterfaceLanguage, interfaceLanguage } from '../i18n';
import { ProjectPreferenceSettings } from './ProjectPreferenceSettings';
import { trapDialogFocus } from '../lib/dialogFocus';
import { RESTORE_PROJECT_INTERVIEW } from '../lib/projectPreferences';
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { useEffect, useState } from "react";
import { RESTORE_EDIT_POSITION_KEY } from "../lib/editPosition";
import { loadBooleanPreference, saveBooleanPreference } from "../lib/preferences";
import type { Dispatch, RefObject, SetStateAction } from "react";

import CredentialManager from "../CredentialManager";
import { EditingPlanSettings } from "./EditingPlanSettings";
import { AIModelSettings } from "./AIModelSettings";

/** 设置弹窗：通用、转录引擎、编辑引擎、编辑方案、诊断与日志。
 *  偏好即时保存，全部通过 props 注入。 */
export interface SettingsModalProps {
  settingsTab: "prefs" | "engines" | "ai" | "plans" | "diagnostics";
  setSettingsTab: Dispatch<SetStateAction<"prefs" | "engines" | "ai" | "plans" | "diagnostics">>;
  settingsRef: RefObject<HTMLDialogElement | null>;
  setSettingsOpen: (open: boolean) => void;
  defaultPlaybackRate: number;
  setDefaultPlaybackRate: (rate: number) => void;
  setPlaybackRate: (rate: number) => void;
  audioRef: { current: HTMLAudioElement | null };
  skipSeconds: number;
  setSkipSeconds: (seconds: number) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  useInterfaceLanguage();
  const [restoreInterview, setRestoreInterview] = useState(() => loadBooleanPreference(RESTORE_PROJECT_INTERVIEW, true));
  const [restorePosition, setRestorePosition] = useState(() => loadBooleanPreference(RESTORE_EDIT_POSITION_KEY, false));
  const {
    settingsTab,
    setSettingsTab,
    settingsRef,
    setSettingsOpen,
    defaultPlaybackRate,
    setDefaultPlaybackRate,
    setPlaybackRate,
    audioRef,
    skipSeconds,
    setSkipSeconds,
  } = props;

  useEffect(() => {
    const dialog = settingsRef.current;
    const previous = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [settingsRef]);

  return (
      <dialog
        ref={settingsRef}
        className="interview-dialog interview-dialog--settings"
        aria-labelledby="settings-title"
        onKeyDown={trapDialogFocus}
        onCancel={event => { event.preventDefault(); setSettingsOpen(false); }}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setSettingsOpen(false);
        }}
      >
        <div className="dialog-header">
          <h2 id="settings-title">{msg('SettingsModal.m0972')}</h2>
          <button type="button" className="dialog-close" onClick={() => setSettingsOpen(false)} aria-label={msg('SettingsModal.m0973')}>
            ×
          </button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label={msg('SettingsModal.m0974')} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const index = tabs.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next].focus(); tabs[next].click();
        }}>
          <button
            type="button"
            role="tab"
            id="settings-tab-prefs"
            aria-controls="settings-panel-prefs"
            aria-selected={settingsTab === "prefs"} tabIndex={settingsTab === "prefs" ? 0 : -1}
            className={`settings-tab${settingsTab === "prefs" ? " settings-tab--active" : ""}`}
            onClick={() => setSettingsTab("prefs")}
          >
            {msg('SettingsModal.m0975')}</button>
          <button
            type="button"
            role="tab"
            id="settings-tab-engines"
            aria-controls="settings-panel-engines"
            aria-selected={settingsTab === "engines"} tabIndex={settingsTab === "engines" ? 0 : -1}
            className={`settings-tab${settingsTab === "engines" ? " settings-tab--active" : ""}`}
            onClick={() => setSettingsTab("engines")}
          >
            {msg('SettingsModal.m0976')}</button>
          <button type="button" role="tab" id="settings-tab-ai" aria-controls="settings-panel-ai"
            aria-selected={settingsTab === "ai"} tabIndex={settingsTab === "ai" ? 0 : -1} className={`settings-tab${settingsTab === "ai" ? " settings-tab--active" : ""}`}
            onClick={() => setSettingsTab("ai")}>{msg('SettingsModal.m0977')}</button>
          <button type="button" role="tab" id="settings-tab-plans" aria-controls="settings-panel-plans"
            aria-selected={settingsTab === "plans"} tabIndex={settingsTab === "plans" ? 0 : -1} className={`settings-tab${settingsTab === "plans" ? " settings-tab--active" : ""}`}
            onClick={() => setSettingsTab("plans")}>{msg('SettingsModal.m0978')}</button>
          <button type="button" role="tab" id="settings-tab-diagnostics" aria-controls="settings-panel-diagnostics"
            aria-selected={settingsTab === "diagnostics"} tabIndex={settingsTab === "diagnostics" ? 0 : -1} className={`settings-tab${settingsTab === "diagnostics" ? " settings-tab--active" : ""}`}
            onClick={() => setSettingsTab("diagnostics")}>{msg('SettingsModal.m0979')}</button>
        </div>
        {/* 各面板按 tab 条件渲染，而不是常驻 + hidden：这样打开设置时不会为了
            一个播放速度去拉 6 个引擎的凭据列表；代价是切到引擎页会重新加载，
            且未保存的新增密钥草稿会随切换丢弃（密钥场景下这个行为更安全）。 */}
        {settingsTab === "prefs" ? (
          <div
            className="settings-body settings-body--general"
            role="tabpanel"
            id="settings-panel-prefs"
            aria-labelledby="settings-tab-prefs"
          >
            <section className="settings-block">
              <label className="field"><span>{msg('language.label')}</span>
                <select aria-label={msg('language.label')} value={interfaceLanguage()} onChange={event => void setInterfaceLanguage(event.target.value as 'zh-CN' | 'en')}>
                  <option value="zh-CN">简体中文</option><option value="en">English</option>
                </select>
              </label>
              <p className="settings-hint">{msg('language.hint')}</p>
            </section>
            <ProjectPreferenceSettings />
            <section className="settings-block">
              <div className="settings-heading"><div><h3>{msg('SettingsModal.m0980')}</h3><p>{msg('SettingsModal.m0981')}</p></div></div>
              <label className="settings-option"><input className="ripple-checkbox" type="checkbox" checked={restoreInterview} onChange={event => {
                setRestoreInterview(event.target.checked); saveBooleanPreference(RESTORE_PROJECT_INTERVIEW, event.target.checked);
              }}/><span>{msg('SettingsModal.m0982')}</span></label>
              <label className="settings-option">
                <input className="ripple-checkbox" type="checkbox" checked={restorePosition} onChange={event => {
                  setRestorePosition(event.target.checked);
                  saveBooleanPreference(RESTORE_EDIT_POSITION_KEY, event.target.checked);
                }} />
                <span>{msg('SettingsModal.m0983')}</span>
              </label>
            </section>

            <section className="settings-block">
              <div className="settings-heading">
                <div>
                  <h3>{msg('SettingsModal.m0984')}</h3>
                  <p>{msg('SettingsModal.m0985')}</p>
                </div>
              </div>
              <div className="settings-grid">
                <label className="field">
                  <span>{msg('SettingsModal.m0986')}</span>
                  <select
                    value={defaultPlaybackRate}
                    aria-label={msg('SettingsModal.m0987')}
                    onChange={(event) => {
                      const rate = Number(event.target.value);
                      setDefaultPlaybackRate(rate);
                      setPlaybackRate(rate);
                      if (audioRef.current) audioRef.current.playbackRate = rate;
                    }}
                  >
                    {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <option value={rate} key={rate}>
                        {rate}×
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{msg('SettingsModal.m0988')}</span>
                  <select
                    value={skipSeconds}
                    aria-label={msg('SettingsModal.m0989')}
                    onChange={(event) => setSkipSeconds(Number(event.target.value))}
                  >
                    {[1, 2, 3, 5, 10].map((seconds) => (
                      <option value={seconds} key={seconds}>
                        {seconds}s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="settings-hint">{msg('SettingsModal.m0990')}</p>
            </section>

          </div>
        ) : settingsTab === "diagnostics" ? (
          <div className="settings-body" role="tabpanel" id="settings-panel-diagnostics" aria-labelledby="settings-tab-diagnostics"><DiagnosticsSettings /></div>
        ) : settingsTab === "plans" ? (
          <div className="settings-body" role="tabpanel" id="settings-panel-plans" aria-labelledby="settings-tab-plans"><EditingPlanSettings /></div>
        ) : settingsTab === "ai" ? (
          <div className="settings-body" role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai"><AIModelSettings /></div>
        ) : (
          <div
            className="settings-body"
            role="tabpanel"
            id="settings-panel-engines"
            aria-labelledby="settings-tab-engines"
          >
            <CredentialManager />
          </div>
        )}
      </dialog>
  );
}
