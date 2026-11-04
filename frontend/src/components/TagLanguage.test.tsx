// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {msg, setInterfaceLanguage} from '../i18n';
import {TagInput} from './TagInput';
import {TagMergeDialog} from './TagMergeDialog';
import {TagMergeRequired} from '../lib/tagCollections';
import {TagTreeError} from '../lib/tags';

beforeEach(async()=>{
  await setInterfaceLanguage('zh-CN');
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN');});

it('retranslates an existing tag error without changing the draft or resubmitting it',async()=>{
  const commit=vi.fn(async()=>{throw new TagTreeError('name_conflict','Synthetic tag');});
  render(<TagInput onCommit={commit} onCancel={()=>{}} availableTags={[]}/>);
  const input=screen.getByRole('combobox') as HTMLInputElement;
  fireEvent.change(input,{target:{value:'Synthetic tag'}});
  await act(async()=>fireEvent.keyDown(input,{key:'Enter'}));
  expect(screen.getByRole('alert').textContent).toBe(msg('tags.nameConflict',{name:'Synthetic tag'}));
  for(const language of ['zh-TW','en'] as const){
    await act(async()=>setInterfaceLanguage(language));
    expect(input.getAttribute('aria-label')).toBe(msg('tags.input'));
    expect(screen.getByRole('alert').textContent).toBe(msg('tags.nameConflict',{name:'Synthetic tag'}));
    expect(input.value).toBe('Synthetic tag');
  }
  expect(commit).toHaveBeenCalledTimes(1);
});

it('updates an open merge confirmation without accepting it or translating the tag path',async()=>{
  const choose=vi.fn();
  render(<TagMergeDialog request={new TagMergeRequired('source','target','Synthetic/Tag',2)} onChoose={choose}/>);
  for(const language of ['zh-CN','zh-TW','en'] as const){
    await act(async()=>setInterfaceLanguage(language));
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText(msg('tags.mergeNotice',{count:2}))).toBeTruthy();
    expect(screen.getByText('Synthetic/Tag')).toBeTruthy();
  }
  expect(choose).not.toHaveBeenCalled();
});
