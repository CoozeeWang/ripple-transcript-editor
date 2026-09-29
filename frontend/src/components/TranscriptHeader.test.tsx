// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TranscriptHeader} from './TranscriptHeader';
afterEach(cleanup);
it('preparation hides empty editing controls and restores them without modifying metadata',()=>{
 const metadata={id:'test',title:'测试访谈',recorded_at:null,location:'',participants:[],topics:[],notes:'',created_at:'',updated_at:''};
 const props={metadata,segmentCount:0,viewingOriginal:false,activeModelId:null,versionControls:<button>当前版本</button>,comparisonControls:<button>修改痕迹</button>,patchMetadata:vi.fn(),forkFromOriginal:vi.fn()};
 const ui=render(<TranscriptHeader {...props} preparing/>);
 expect(screen.getByRole('heading',{name:'测试访谈'})).toBeTruthy();
 expect(screen.queryByText("添加录制时间")).toBeNull();expect(screen.queryByText('当前版本')).toBeNull();expect(screen.queryByText('0 个片段')).toBeNull();
 ui.rerender(<TranscriptHeader {...props}/>);
 expect(screen.getByText("添加录制时间")).toBeTruthy();expect(screen.getByText('当前版本')).toBeTruthy();expect(props.patchMetadata).not.toHaveBeenCalled();
});

it('commits date-only metadata without a fabricated time',()=>{
 const patchMetadata=vi.fn();
 const metadata={id:'test',title:'测试访谈',recorded_at:null,location:'',participants:[],topics:[],notes:'',created_at:'',updated_at:''};
 const props={metadata,segmentCount:0,viewingOriginal:true,activeModelId:'m1',versionControls:null,patchMetadata,forkFromOriginal:vi.fn()};
 const ui=render(<TranscriptHeader {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:"录制日期和时间"}));
 for(const [name,value] of [['年','2026'],['月','9'],['日','20']])fireEvent.change(screen.getByRole('textbox',{name:`录制日期和时间：${name}`}),{target:{value}});
 fireEvent.keyDown(screen.getByRole('textbox',{name:'录制日期和时间：时'}),{key:'Enter'});
 expect(patchMetadata).toHaveBeenCalledWith({recorded_at:'2026-09-20'});
 ui.rerender(<TranscriptHeader {...props} metadata={{...metadata,recorded_at:'2026-09-20'}}/>);
 expect(screen.getByRole('button',{name:"录制日期和时间"}).textContent).toBe('2026-09-20HH:MM');
});

it('offers a keyboard-accessible time hint without saving it, then restores it when time is cleared',()=>{
 const patchMetadata=vi.fn();
 const metadata={id:'test',title:'测试访谈',recorded_at:'2026-09-20',location:'',participants:[],topics:[],notes:'',created_at:'',updated_at:''};
 const props={metadata,segmentCount:0,viewingOriginal:true,activeModelId:'m1',versionControls:null,patchMetadata,forkFromOriginal:vi.fn()};
 const ui=render(<TranscriptHeader {...props}/>);
 const dateButton=()=>screen.getByRole('button',{name:'录制日期和时间'});
 expect(screen.getByText('HH:MM').closest('[role="button"]')).toBe(dateButton());
 dateButton().focus();fireEvent.keyDown(dateButton(),{key:'Enter'});
 expect(screen.getByRole('textbox',{name:'录制日期和时间：时'})).toBeTruthy();
 fireEvent.keyDown(screen.getByRole('textbox',{name:'录制日期和时间：时'}),{key:'Enter'});
 expect(patchMetadata).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('HH:MM'));
 fireEvent.change(screen.getByRole('textbox',{name:'录制日期和时间：时'}),{target:{value:'14'}});
 fireEvent.change(screen.getByRole('textbox',{name:'录制日期和时间：分'}),{target:{value:'30'}});
 fireEvent.keyDown(screen.getByRole('textbox',{name:'录制日期和时间：分'}),{key:'Enter'});
 expect(patchMetadata).toHaveBeenLastCalledWith({recorded_at:'2026-09-20T14:30:00'});
 ui.rerender(<TranscriptHeader {...props} metadata={{...metadata,recorded_at:'2026-09-20T14:30:00'}}/>);
 expect(dateButton().textContent).toBe('2026-09-20 14:30');
 fireEvent.click(dateButton());
 fireEvent.change(screen.getByRole('textbox',{name:'录制日期和时间：时'}),{target:{value:''}});
 fireEvent.change(screen.getByRole('textbox',{name:'录制日期和时间：分'}),{target:{value:''}});
 fireEvent.keyDown(screen.getByRole('textbox',{name:'录制日期和时间：分'}),{key:'Enter'});
 expect(patchMetadata).toHaveBeenLastCalledWith({recorded_at:'2026-09-20'});
 ui.rerender(<TranscriptHeader {...props}/>);
 expect(screen.getByText('HH:MM')).toBeTruthy();
});
