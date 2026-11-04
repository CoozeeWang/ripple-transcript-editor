// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ConnectorContext,type ConnectorState} from '../hooks/connectorContext';
import type {AIEditActivity} from '../lib/aiEditOwnership';
import {AIEditingBadge} from './AIEditingBadge';
import {msg,setInterfaceLanguage} from '../i18n';
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN')});
const task:AIEditActivity={task_id:'task',client:'chatgpt',key:'key',version:'Synthetic A',version_id:'m:e1',target:{project_id:'p',project:'Synthetic',interview_id:'i',interview:'Synthetic',recording_id:'a',recording:'Synthetic A',version_id:'m:e1',version:'Synthetic'},kind:'incremental',state:'processing',requestId:'request',requestStatus:'editing',requestComplete:false,processed:0,saved:24,total:100,inFlight:0,touched:0};
it.each(['zh-CN','zh-TW','en'] as const)('shows red status only for the exact A version and keeps waiting/failure/stop accurate (%s)',async lang=>{
 await setInterfaceLanguage(lang);const state={activities:[task]} as ConnectorState;
 const view=()=> <ConnectorContext.Provider value={{state,register:vi.fn(),unregister:vi.fn()}}><AIEditingBadge project="p" interview="i" recording="a" version="m:e1"/><AIEditingBadge project="p" interview="i" recording="b" version="m:e1"/><AIEditingBadge project="p" interview="i" recording="a" version="m:e2"/></ConnectorContext.Provider>;
 const {rerender}=render(view());expect(screen.getAllByRole('status')).toHaveLength(1);expect(screen.getByRole('status').textContent).toBe(msg('aiEditing.badgeWorking'));
 state.activities=[{...task,state:'completed',requestStatus:'waiting'}];rerender(view());expect(screen.getByRole('status').textContent).toBe(msg('aiEditing.badgeWaiting'));
 state.activities=[{...task,state:'ended',reason:'failure',requestStatus:'failed'}];rerender(view());expect(screen.getByRole('status').textContent).toBe(msg('aiEditing.badgeFailed'));
 state.activities=[{...task,state:'ended',reason:'user_cancelled',inFlight:1,requestStatus:'stopped'}];rerender(view());expect(screen.getByRole('status').textContent).toBe(msg('aiEditing.badgeConfirming'));
 state.activities=[{...task,state:'ended',reason:'user_cancelled',requestStatus:'stopped'}];rerender(view());expect(screen.queryByRole('status')).toBeNull();
 state.activities=[{...task,state:'completed',requestComplete:true,requestStatus:'completed'}];rerender(view());expect(screen.queryByRole('status')).toBeNull();
});
