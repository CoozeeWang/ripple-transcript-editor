// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentPicker } from "./SegmentPicker";
import { setInterfaceLanguage } from '../i18n';
const segments=[{id:"a",start:5,end:10,text:"第一句",speaker_id:"s"},{id:"b",start:65,end:70,text:"讨论教育",speaker_id:"s"},{id:"c",start:125,end:130,text:"最后一段",speaker_id:"s"}];
afterEach(async () => { cleanup(); await setInterfaceLanguage('zh-CN'); });
function Example(){const [value,setValue]=useState(0);return <SegmentPicker segments={segments} value={value} onChange={setValue} label="起始片段"/>;}
it("searches by number, time and text, then selects with the keyboard",()=>{
 const ui=render(<Example/>);const button=ui.getByRole('button',{name:'起始片段'});fireEvent.click(button);
 const search=ui.getByRole('combobox');
 for(const query of ['2','01:05','教育']){fireEvent.change(search,{target:{value:query}});expect(ui.getByRole('option',{name:/片段 2/})).toBeTruthy();}
 fireEvent.keyDown(search,{key:'Enter'});expect(button.textContent).toContain('片段 2 · [01:05] · 讨论教育');expect(ui.queryByRole('listbox')).toBeNull();
 fireEvent.click(button);fireEvent.change(ui.getByRole('combobox'),{target:{value:'不存在'}});expect(ui.getByText('没有匹配的片段')).toBeTruthy();fireEvent.keyDown(ui.getByRole('combobox'),{key:'Escape'});expect(document.activeElement).toBe(button);
 fireEvent.click(button);fireEvent.keyDown(ui.getByRole('combobox'),{key:'ArrowDown'});fireEvent.keyDown(ui.getByRole('combobox'),{key:'Enter'});expect(button.textContent).toContain('片段 3');
 fireEvent.click(button);fireEvent.pointerDown(document.body);expect(ui.queryByRole('listbox')).toBeNull();
});

it('keeps numbered options, search and keyboard selection intact across a live language switch', async () => {
  const segments = Array.from({ length: 12 }, (_, index) => ({
    id: `synthetic-${index}`, speaker_id: 'synthetic', start: index * 10,
    end: (index + 1) * 10, text: `Synthetic segment ${index + 1}`,
  }));
  const onChange = vi.fn();
  const ui = render(<SegmentPicker segments={segments} value={9} onChange={onChange} label="Start segment" />);
  fireEvent.click(ui.getByRole('button', { name: 'Start segment' }));
  const search = ui.getByRole('combobox');
  expect(document.activeElement).toBe(search);
  expect(ui.getAllByRole('option')[9].firstElementChild?.textContent).toBe('片段 10');
  fireEvent.change(search, { target: { value: '12' } });
  await act(() => setInterfaceLanguage('en'));
  expect(ui.getAllByRole('option')).toHaveLength(1);
  const row = ui.getByRole('option');
  expect(row.firstElementChild?.textContent).toBe('Segment 12');
  expect(ui.container.querySelector('.segment-picker-columns')?.firstElementChild?.textContent).toBe('Segment');
  expect((search as HTMLInputElement).value).toBe('12');
  expect(row.getAttribute('aria-label')).toContain('12');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(11);
  expect(ui.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(ui.getByRole('button', { name: 'Start segment' }));
});
