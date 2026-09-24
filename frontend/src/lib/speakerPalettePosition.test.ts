import {expect,it} from 'vitest';
import {placeSpeakerPalette} from './speakerPalettePosition';
it('keeps a palette near the left edge inside the window',()=>{
 const result=placeSpeakerPalette({left:80,right:100,top:100,bottom:120},{width:148,height:170},900,700);
 expect(result.left).toBe(8);expect(result.top).toBe(126);
});
it('opens upwards near the bottom and stays inside the right edge',()=>{
 const result=placeSpeakerPalette({left:880,right:905,top:650,bottom:675},{width:148,height:170},900,700);
 expect(result.left+148).toBeLessThanOrEqual(892);expect(result.top).toBe(474);
});
it('repositions expanded content and bounds its scroll height in a short window',()=>{
 const result=placeSpeakerPalette({left:80,right:100,top:130,bottom:150},{width:148,height:350},400,240);
 expect(result.maxHeight).toBe(224);expect(result.top).toBe(8);
});
