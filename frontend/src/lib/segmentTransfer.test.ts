import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { escapeRtf, parseSegmentLink, segmentLink, segmentTransfer } from './segmentTransfer';
const target = { project:'project-1', recording:'recording-1', model:'m1', version:'e1', segment:'seg_split_123',identity:'12345678-1234-4234-8234-123456789abc' };
it('links the full source line with the time range and literal punctuation in an HTML-aware Markdown consumer', async () => {
 const segments=Array.from({length:5},(_,i)=>({id:i===4?target.segment:`s${i}`,speaker_id:'s',start:0,end:10,text:'Body'}));
 const transcript={audio:{filename:'synthetic.wav',duration:10},speakers:[{id:'s',name:'Speaker'}],segments};
 const source='Synthetic_20261029_A (draft) [name], 00:00–00:10, (5)';
 const result=segmentTransfer(transcript,segments[4],'Synthetic_20261029_A (draft) [name]',target);
 expect(result.plain).toBe(`Speaker：Body\n\n${source}\n${segmentLink(target)}`);
 expect(result.html).toContain(`>${source}</a>`);
 expect(result.rtf).toContain(`\\fldrslt \\cf1\\ul ${escapeRtf(source)}\\ulnone\\cf0 }}`);
 expect(await marked.parse(result.html)).toContain(`>${source}</a>`);
 expect(result.html).toContain('00:00–00:10');
});
describe('segment transfer', () => {
 it('round trips stable identities without titles, numbers or paths', () => { expect(parseSegmentLink(segmentLink(target))).toEqual(target); });
 it.each(['https://open/v1','ripple-segment-dev://open/v2','ripple-segment-dev://user@open/v1','ripple-segment-dev://open/v1?project=../../private'])('rejects unsupported or unsafe links %s', raw => { expect(() => parseSegmentLink(raw)).toThrow(); });
 it('rejects duplicate keys and fragments', () => { for(const tail of ['&project=other','#x','&path=private']) expect(()=>parseSegmentLink(segmentLink(target)+tail)).toThrow(); });
 it('exports plain current text and escaped named links', () => {
  const segment = {id:target.segment, speaker_id:'speaker',start:1,end:3,text:'<script>\n第二段 &'};
  const transcript={audio:{filename:'synthetic.wav',duration:3},speakers:[{id:'speaker',name:'说话人'}],segments:[segment]};
  const result=segmentTransfer(transcript,segment,'访谈 <一>',target);
  expect(result.plain).toContain('说话人：<script>\n第二段 &\n\n访谈 <一>, 00:01–00:03, (1)\nripple-segment-dev:');
  expect(result.html).toContain('&lt;script&gt;<br>第二段 &amp;');
  expect(result.html).toContain('>访谈 &lt;一&gt;, 00:01–00:03, (1)</a>');
  expect(result.plain).toMatch(/^说话人：<script>/);
  expect(result.rtf).toContain('HYPERLINK "ripple-segment-dev://open/v2?');
  expect(result.rtf).toContain('\\fldrslt \\cf1\\ul');
  expect(result.rtf).toContain('\\par\\par');
  expect(result.html).toContain('style="color:#704aa1;text-decoration:underline"');
  expect(result.html).toContain('<div><br></div>');
  expect([...result.rtf].every(char => char.charCodeAt(0) < 128)).toBe(true);
  expect(segmentTransfer({...transcript,timeAligned:false},segment,'标题').plain).toContain('标题, (1)');
 });
});

it.each(['', '\n\n', 'First\r\n\r\nSecond\n'])('keeps empty and multi-paragraph bodies well formed: %j', text => {
 const segment={id:target.segment,speaker_id:'s',start:1,end:3,text};
 const transcript={audio:{filename:'synthetic.wav',duration:3},speakers:[{id:'s',name:'Speaker'}],segments:[segment]};
 const result=segmentTransfer(transcript,segment,'Synthetic_20261029_A',target);
 const body=text.replace(/\r\n?/g,'\n').replace(/^\n+|\n+$/g,'');
 expect(result.plain).toBe(`Speaker：${body}\n\nSynthetic_20261029_A, 00:01–00:03, (1)\n${segmentLink(target)}`);
 expect(result.html).toContain('>Synthetic_20261029_A, 00:01–00:03, (1)</a></div>');
 expect(result.html.match(/<div><br><\/div>/g)).toHaveLength(1);
 expect(result.rtf).toContain(`${escapeRtf('Synthetic_20261029_A, 00:01–00:03, (1)')}\\ulnone\\cf0 }}`);
});

it('escapes markup without interpreting underscore titles and links the complete source line', () => {
 const segment={id:target.segment,speaker_id:'s',start:0,end:1,text:'<body> & {text} \\ literal'};
 const transcript={audio:{filename:'synthetic.wav',duration:1},speakers:[{id:'s',name:'A<&"'}],segments:[segment]};
 const title='合成_20261029_A <&" {source} \\';
 const result=segmentTransfer(transcript,segment,title,target);
 expect(result.html).toContain('A&lt;&amp;&quot;：&lt;body&gt; &amp; {text} \\ literal');
 expect(result.html).toContain('>合成_20261029_A &lt;&amp;&quot; {source} \\, 00:00–00:01, (1)</a>');
 expect(result.rtf).toContain(escapeRtf(title));
 expect(result.rtf.match(/HYPERLINK/g)).toHaveLength(1);
 expect(result.plain).toContain(title+', 00:00–00:01, (1)');
 expect(segmentTransfer(transcript,segment,title).plain.endsWith(title+', 00:00–00:01, (1)')).toBe(true);
});

it('separates the source by one blank line while preserving internal paragraphs', () => {
 const segment={id:'synthetic',speaker_id:'s',start:0,end:1,text:'\n\nFirst\n\nSecond\n'};
 const transcript={audio:{filename:'synthetic.wav',duration:1},speakers:[{id:'s',name:'Speaker'}],segments:[segment],timeAligned:false};
 expect(segmentTransfer(transcript,segment,'Source').plain).toBe('Speaker：First\n\nSecond\n\nSource, (1)');
});


it.each([
 [516,563,'08:36–09:23'],
 [0,0,'00:00–00:00'],
 [59.999,60,'00:59–01:00'],
 [3599.9,3600,'59:59–1:00:00'],
 [3661,90061,'1:01:01–25:01:01'],
])('keeps both timestamp boundaries %s–%s inside the single source link', (start,end,time) => {
 const segment={id:target.segment,speaker_id:'s',start,end,text:'Body'};
 const transcript={audio:{filename:'synthetic.wav',duration:end},speakers:[{id:'s',name:'Speaker'}],segments:[segment]};
 const result=segmentTransfer(transcript,segment,'Source',target);
 const source=`Source, ${time}, (1)`;
 expect(result.plain).toBe(`Speaker：Body\n\n${source}\n${segmentLink(target)}`);
 expect(result.html).toContain(`>${source}</a>`);
 expect(result.html.match(/<a /g)).toHaveLength(1);
 expect(result.rtf).toContain(`\\fldrslt \\cf1\\ul ${escapeRtf(source)}\\ulnone\\cf0 }}`);
});
