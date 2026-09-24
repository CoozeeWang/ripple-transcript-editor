// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SegmentPicker } from "./SegmentPicker";
const segments=[{id:"a",start:5,end:10,text:"第一句",speaker_id:"s"},{id:"b",start:65,end:70,text:"讨论教育",speaker_id:"s"},{id:"c",start:125,end:130,text:"最后一段",speaker_id:"s"}];
afterEach(cleanup);
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
