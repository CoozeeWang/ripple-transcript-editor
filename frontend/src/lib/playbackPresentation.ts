import type { Segment } from '../types';

/** Inactive rows keep one stable prop while the active row follows the audio clock.
 * Global isPlaying remains separate: clicking another row must still seek during playback. */
export function segmentPlaybackTime(segment: Pick<Segment, 'start' | 'end'>, time: number, playing: boolean): number {
    return playing && time >= segment.start && time < segment.end ? time : Number.NEGATIVE_INFINITY;
}
