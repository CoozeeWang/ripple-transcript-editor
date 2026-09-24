// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { openingSegmentId, RESTORE_EDIT_POSITION_KEY } from "./editPosition";
import { saveBooleanPreference } from "./preferences";
import type { Transcript } from "../types";
const transcript: Transcript = {audio:{filename:"test.wav",duration:20},speakers:[],segments:[
  {id:"a",text:"甲",speaker_id:"s",start:0,end:10},
  {id:"b",text:"乙",speaker_id:"s",start:10,end:20},
],lastEditedSegmentId:"b"};
afterEach(() => localStorage.clear());
it("restores the saved editing segment only when enabled", () => {
  expect(openingSegmentId(transcript)).toBe("a");
  saveBooleanPreference(RESTORE_EDIT_POSITION_KEY,true);
  expect(openingSegmentId(JSON.parse(JSON.stringify(transcript)))).toBe("b");
  saveBooleanPreference(RESTORE_EDIT_POSITION_KEY,false);
  expect(openingSegmentId(transcript)).toBe("a");
});
it("older documents and deleted segments fall back to the first segment", () => {
  saveBooleanPreference(RESTORE_EDIT_POSITION_KEY,true);
  expect(openingSegmentId({...transcript,lastEditedSegmentId:undefined})).toBe("a");
  expect(openingSegmentId({...transcript,lastEditedSegmentId:"deleted"})).toBe("a");
  expect(openingSegmentId({...transcript,segments:[]})).toBe("");
});
