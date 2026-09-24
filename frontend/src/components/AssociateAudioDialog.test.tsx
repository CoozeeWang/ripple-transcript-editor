// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {AssociateAudioDialog} from './AssociateAudioDialog';
import type {ProjectRecording} from '../lib/projectStore';
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};});afterEach(cleanup);
it('associates with one click and explains an empty scene',()=>{
 const onConfirm=vi.fn();const props={name:'文稿',anchor:{right:400,bottom:200} as DOMRect,busy:false,error:'',onClose:vi.fn(),onConfirm};
 const {rerender}=render(<AssociateAudioDialog {...props} recordings={[{id:'r',name:'采访.wav'} as ProjectRecording]}/>);
 fireEvent.click(screen.getByRole('button',{name:'采访.wav'}));expect(onConfirm).toHaveBeenCalledWith('r');
 expect(screen.queryByRole('combobox')).toBeNull();
 rerender(<AssociateAudioDialog {...props} recordings={[]}/>);expect(screen.getByText('本场次暂无音频，请先加入音频。')).toBeTruthy();
});
