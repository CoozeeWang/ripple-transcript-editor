import { describe, expect, it } from 'vitest';
import { parseSegmentLink, segmentLink, segmentTransfer } from './segmentTransfer';
const target = { project:'project-1', recording:'recording-1', model:'m1', version:'e1', segment:'seg_split_123',identity:'12345678-1234-4234-8234-123456789abc' };
describe('segment transfer', () => {
 it('round trips stable identities without titles, numbers or paths', () => { expect(parseSegmentLink(segmentLink(target))).toEqual(target); });
 it.each(['https://open/v1','ripple-segment-dev://open/v2','ripple-segment-dev://user@open/v1','ripple-segment-dev://open/v1?project=../../private'])('rejects unsupported or unsafe links %s', raw => { expect(() => parseSegmentLink(raw)).toThrow(); });
 it('rejects duplicate keys and fragments', () => { for(const tail of ['&project=other','#x','&path=private']) expect(()=>parseSegmentLink(segmentLink(target)+tail)).toThrow(); });
 it('exports plain current text and escaped named links', () => {
  const segment = {id:target.segment, speaker_id:'speaker',start:1,end:3,text:'<script>\n第二段 &'};
  const transcript={audio:{filename:'synthetic.wav',duration:3},speakers:[{id:'speaker',name:'说话人'}],segments:[segment]};
  const result=segmentTransfer(transcript,segment,'访谈 <一>',target);
  expect(result.plain).toContain('<script>\n第二段 &\n访谈 <一>\nripple-segment-dev:');
  expect(result.html).toContain('&lt;script&gt;<br>第二段 &amp;');
  expect(result.html).toContain('>访谈 &lt;一&gt;</a>');
  expect(result.plain).toMatch(/^说话人 \[00:01–00:03\] \(1\)\n/);
  expect(result.rtf).toContain('HYPERLINK "ripple-segment-dev://open/v2?');
  expect(result.rtf).toContain('\\fldrslt \\cf1\\ul');
  expect(result.rtf).not.toContain('\\par\\par');
  expect(result.html).toContain('style="color:#704aa1;text-decoration:underline"');
  expect(result.html).not.toContain('<div><br></div>');
  expect([...result.rtf].every(char => char.charCodeAt(0) < 128)).toBe(true);
  expect(segmentTransfer({...transcript,timeAligned:false},segment,'标题').plain).toMatch(/^说话人 \(1\)\n/);
 });
});

it('uses compact boundaries while preserving internal paragraphs', () => {
 const segment={id:'synthetic',speaker_id:'s',start:0,end:1,text:'\n\nFirst\n\nSecond\n'};
 const transcript={audio:{filename:'synthetic.wav',duration:1},speakers:[{id:'s',name:'Speaker'}],segments:[segment],timeAligned:false};
 expect(segmentTransfer(transcript,segment,'Source').plain).toBe('Speaker (1)\nFirst\n\nSecond\nSource');
});
