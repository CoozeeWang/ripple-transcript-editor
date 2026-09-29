import { msg } from '../i18n';
import type { ProjectImportStage } from '../lib/projectStore';
import './projectImportStatus.css';

export function ProjectImportStatus({ stage }: { stage: ProjectImportStage }) {
  return <p className="project-import-status" role="status" aria-live="polite">{msg(`projectImport.${stage}`)}</p>;
}
