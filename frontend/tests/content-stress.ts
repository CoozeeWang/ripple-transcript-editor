/** Synthetic B1 data. Called only by the isolated development harness. */
import { createProject, importProjectMaterials, rememberProject, saveProject } from '../src/lib/projectStore';
import type { ImportMaterial } from '../src/lib/materialImport';
import type { Transcript } from '../src/types';

export async function createContentStress(parent: FileSystemDirectoryHandle, files: FileSystemDirectoryHandle) {
  const stamp = Date.now().toString(36);
  let project = await createProject(parent, `B1_${stamp}_河岸社区口述史与城市更新研究_跨年度访谈整理_LongProjectNameWithoutSpaces_第二阶段资料复核`);
  const people = [
    '采访者｜河岸社区口述史联合调查小组·资料整理与追访负责人',
    '受访者｜曾任河岸书店联合创办人与社区公共阅读活动志愿协调员',
    'LongSpeakerNameWithoutSpacesForLayoutInspectionABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ];
  const materials: ImportMaterial[] = [];
  for (let scene = 1; scene <= 12; scene++) {
    for (let item = 1; item <= 8; item++) {
      const long = scene === 1 && item === 1;
      const name = `${String(scene).padStart(2,'0')}-${item}_${long ? '千段长稿' : '补充访谈'}_河岸社区公共阅读空间的建立与变化_AdditionalNotesWithoutSpacesForLayoutReview.json`;
      const transcript: Transcript = {
        timeAligned: false, audio: { filename: name, duration: 0 },
        speakers: people.map((name, i) => ({ id: `speaker-${i}`, name })),
        segments: Array.from({length: long ? 1200 : 4}, (_, i) => ({
          id: `segment-${i+1}`, speaker_id: `speaker-${i%3}`, start: 0, end: 0,
          text: `第${i+1}段。我们记录社区书店的变化，保留采访中的原话与停顿。` +
            (long && i === 0 ? '\n\n第二自然段：' + '这是需要完整阅读且自动换行的多段正文。'.repeat(45) + '\n\n第三自然段：https://example.invalid/' + 'LongUnbrokenPath'.repeat(18) : '') +
            (i === 599 ? ' 中点定位标记河岸灯塔。' : '') + (i === 1199 ? ' 终点定位标记小船归港。' : ''),
        })),
      };
      const handle = await files.getFileHandle(name, {create:true});
      const writer = await handle.createWritable(); await writer.write(JSON.stringify(transcript)); await writer.close();
      materials.push({id:crypto.randomUUID(),handle,name,kind:'manuscript',audioId:'',transcript,
        group:`访谈${String(scene).padStart(2,'0')}｜河岸社区公共阅读与城市记忆_多位参与者联合回访_LongSessionNameWithoutSpaces`});
    }
  }
  project = await importProjectMaterials(project, materials, 'copy');
  project = await saveProject(project, {...project.data, description:'隔离合成资料：12 场次、每场 8 份文稿，共 96 份；首份 1200 段，含多段落及连续英文。'});
  await rememberProject(project);
  return project.directory.name;
}
