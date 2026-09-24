// UI-only fixture: no filesystem, service calls, or saved user preferences.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectTrashDialog } from '../src/components/ProjectTrashDialog';
import type { OpenProject } from '../src/lib/projectStore';
import '../src/styles.css';
import '../src/components/projectWorkspace.css';

export function Preview() {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(['a', 'b']);
  const project = { data: { interviews: [{ id: 'scene', title: '合成访谈场次' }], trash: ids.map(id => ({
    id, name: `测试文稿 ${id}`, interviewId: 'scene', deletedAt: '2026-09-22', recording: { storage: 'none' },
  })) } } as unknown as OpenProject;
  return <main style={{padding: 32}}><h1>回收站确认与焦点检查</h1>
    <p>仅改变内存中的合成记录，不读取或删除文件。</p>
    <button className="button" onClick={() => setOpen(true)}>打开测试回收站</button>
    <p role="status">内存记录：{ids.length} 项</p>
    {open && <ProjectTrashDialog project={project} busy={false} onClose={() => setOpen(false)}
      onRestore={id => setIds(items => items.filter(item => item !== id))} onClear={() => setIds([])} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
