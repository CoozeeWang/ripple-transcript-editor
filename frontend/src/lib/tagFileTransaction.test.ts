import { expect, it } from 'vitest';
import { commitTagFileTransaction, recoverTagFileTransaction, type TagFilePatch } from './tagFileTransaction';
import { tagTestFs } from './tagTestFs';

const first = ['interviews', 'synthetic', 'sample.transcript', 'version.json'];
function setup(beforeWrite?: (path: string) => void) {
    const fs = tagTestFs('synthetic.ripple', beforeWrite);
    fs.directories.add('interviews'); fs.directories.add('interviews/synthetic'); fs.directories.add('interviews/synthetic/sample.transcript');
    fs.files.set(first.join('/'), 'original synthetic version'); fs.files.set('ripple-project.json', 'original synthetic index');
    const patches: TagFilePatch[] = [{ path: first, before: 'original synthetic version', after: 'changed synthetic version' },
        { path: ['ripple-project.json'], before: 'original synthetic index', after: 'changed synthetic index' }];
    return { ...fs, patches };
}
it('commits with a verified recoverable journal and does not accumulate redundant archives', async () => {
    const fs = setup(); await commitTagFileTransaction(fs.root, fs.patches);
    expect(fs.files.get(first.join('/'))).toBe('changed synthetic version');
    expect(fs.files.get('ripple-project.json')).toBe('changed synthetic index');
    expect(fs.files.has('.ripple-tag-transaction.json')).toBe(false);
    expect([...fs.files.keys()].some(path => path.startsWith('.ripple-tag-backups/'))).toBe(false);
});
it('rolls back previously written versions if the project index write fails', async () => {
    let failed = false;
    const fs = setup(path => { if (path === 'ripple-project.json' && !failed) { failed = true; throw Error('synthetic disk failure'); } });
    await expect(commitTagFileTransaction(fs.root, fs.patches)).rejects.toThrow('synthetic disk failure');
    expect(fs.files.get(first.join('/'))).toBe('original synthetic version');
    expect(fs.files.get('ripple-project.json')).toBe('original synthetic index');
    expect(fs.files.has('.ripple-tag-transaction.json')).toBe(false);
});
it('recovers an interrupted prepared transaction but never overwrites foreign edits', async () => {
    const fs = setup(); fs.files.set(first.join('/'), 'changed synthetic version');
    const journal = JSON.stringify({ kind: 'ripple-tag-transaction', version: 1, id: 'synthetic-id', state: 'prepared', patches: fs.patches });
    fs.files.set('.ripple-tag-transaction.json', journal);
    await recoverTagFileTransaction(fs.root);
    expect(fs.files.get(first.join('/'))).toBe('original synthetic version');
    fs.files.set('.ripple-tag-transaction.json', journal); fs.files.set(first.join('/'), 'independent content');
    await expect(recoverTagFileTransaction(fs.root)).rejects.toThrow('recovery_conflict');
    expect(fs.files.get(first.join('/'))).toBe('independent content');
    expect(fs.files.has('.ripple-tag-transaction.json')).toBe(true);
});
it('rejects unsafe journal paths and stale snapshots before writing any manuscript', async () => {
    const fs = setup();
    await expect(commitTagFileTransaction(fs.root, [{ ...fs.patches[0], path: ['..', 'victim.json'] }])).rejects.toThrow('invalid_journal');
    fs.files.set(first.join('/'), 'another edit');
    await expect(commitTagFileTransaction(fs.root, fs.patches)).rejects.toThrow('concurrent_change');
    expect(fs.files.has('.ripple-tag-transaction.json')).toBe(false);
});
it('treats committed-but-not-cleaned journals as successful rather than undoing the edit', async () => {
    const fs = setup(); for (const patch of fs.patches) fs.files.set(patch.path.join('/'), patch.after!);
    fs.files.set('.ripple-tag-transaction.json', JSON.stringify({ kind: 'ripple-tag-transaction', version: 1, id: 'synthetic-id', state: 'committed', patches: fs.patches }));
    await recoverTagFileTransaction(fs.root);
    expect(fs.files.get(first.join('/'))).toBe('changed synthetic version');
});
it('repeated saves leave no per-operation archive growth and never delete pre-existing history',async()=>{
 const fs=setup();fs.directories.add('.ripple-tag-backups');fs.files.set('.ripple-tag-backups/legacy.json','keep existing history');
 let value='original synthetic index';
 for(let i=0;i<20;i++){const next='synthetic '+i;await commitTagFileTransaction(fs.root,[{path:['ripple-project.json'],before:value,after:next}]);value=next}
 expect([...fs.files.keys()].sort()).toEqual([first.join('/'),'ripple-project.json','.ripple-tag-backups/legacy.json'].sort());
 expect(fs.files.get('.ripple-tag-backups/legacy.json')).toBe('keep existing history');
});
