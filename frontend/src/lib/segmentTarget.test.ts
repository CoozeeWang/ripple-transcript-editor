// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { projectConnectorFixture } from '../testUtils/syntheticProjectConnector';
import { ensureVersionLinkIdentity } from '../localStore';
import { resolveSegmentTarget } from './segmentTarget';
it('keeps an opaque version identity across display name changes and ordinary saves', async () => {
 const fixture=await projectConnectorFixture(); const project=fixture.project!;
 const identity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 expect(await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1')).toBe(identity);
 const target={project:project.data.id,recording:'recording-session-a',model:'m1',version:'e1',segment:'s2',identity};
 project.data.title='Renamed project'; project.data.interviews[0].title='Renamed session';project.data.interviews[0].recordings[0].name='Renamed manuscript';
 expect((await resolveSegmentTarget(project,target)).recording.id).toBe(target.recording);
 const original=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','original');expect(original).not.toBe(identity);
 expect((await resolveSegmentTarget(project,{...target,version:'original',identity:original})).version).toBe('original');
});
it('rejects wrong project, deleted segment, stale UUID and duplicate version identities', async () => {
 const fixture=await projectConnectorFixture();const project=fixture.project!;
 const identity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 const target={project:project.data.id,recording:'recording-session-a',model:'m1',version:'e1',segment:'s2',identity};
 for(const patch of [{project:'wrong'},{segment:'deleted'},{identity:'00000000-0000-4000-8000-000000000000'}]) await expect(resolveSegmentTarget(project,{...target,...patch})).rejects.toThrow();
 // Duplicate the actual indexed location: ambiguity must fail even if the local hint matches one row.
 project.data.interviews[0].recordings.push({...project.data.interviews[0].recordings[0],id:'duplicate-recording'});
 await expect(resolveSegmentTarget(project,target)).rejects.toThrow();
});
