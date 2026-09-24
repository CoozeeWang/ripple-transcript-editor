// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AIPlanSections } from './AIPlanSections';
import { emptyPlanForms, type PlanForms } from '../lib/planForms';
import { ENGLISH_EDITING_RULES } from '../lib/englishEditingRules';
import { setInterfaceLanguage } from '../i18n';
import type { Transcript } from '../types';
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN');});
it('adds English rules only on request and keeps their instruction text across language changes',async()=>{
 const onUse=vi.fn();
 const transcript:Transcript={audio:{filename:'',duration:0},speakers:[],segments:[]};
 function Fixture(){const [forms,onChange]=useState<PlanForms>({...emptyPlanForms(),mode:'custom'});return <AIPlanSections plans={[]} onSaved={()=>{}} onDeleted={()=>{}} active={{id:'',name:'',instructions:''}} onUse={onUse} forms={forms} onChange={onChange} transcript={transcript} original={null} engineId="" hasEngine={false} disabled={false} run={async(_,work)=>work(new AbortController().signal)}/>;}
 render(<Fixture/>);
 expect(screen.queryByDisplayValue(ENGLISH_EDITING_RULES[0].text)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'添加英文标点规则'}));
 expect(screen.getByDisplayValue(ENGLISH_EDITING_RULES[0].text)).toBeTruthy();
 expect(onUse).not.toHaveBeenCalled();
 await act(()=>setInterfaceLanguage('en'));
 expect(screen.getByDisplayValue(ENGLISH_EDITING_RULES[0].text)).toBeTruthy();
 expect((screen.getByRole('button',{name:'Add English punctuation rule'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Add English spacing rule'}));
 expect(screen.getByDisplayValue(ENGLISH_EDITING_RULES[1].text)).toBeTruthy();
 expect(onUse).not.toHaveBeenCalled();
});
