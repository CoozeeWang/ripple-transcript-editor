import { expect, it } from 'vitest';
import { segmentPlaybackTime } from './playbackPresentation';

it('keeps distant rows stable across ticks, seeks and pauses, including a first row starting at zero', () => {
 const first={start:0,end:2},next={start:2,end:4},far={start:100,end:102};
 expect(segmentPlaybackTime(first,.25,true)).toBe(.25);
 expect(segmentPlaybackTime(first,2,true)).toBe(Number.NEGATIVE_INFINITY);
 expect(segmentPlaybackTime(next,2,true)).toBe(2);
 expect(segmentPlaybackTime(far,.25,true)).toBe(segmentPlaybackTime(far,3.5,true));
 expect(segmentPlaybackTime(far,101,true)).toBe(101);
 expect(segmentPlaybackTime(far,101,false)).toBe(Number.NEGATIVE_INFINITY);
 expect(segmentPlaybackTime({start:0,end:0},0,true)).toBe(Number.NEGATIVE_INFINITY);
});
