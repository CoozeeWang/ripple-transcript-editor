import { createPortal } from 'react-dom';
import { msg } from '../i18n';
import type { ProjectImportStage } from '../lib/projectStore';
import './projectImportStatus.css';

export function ProjectImportStatus({ stage, onCancel }: { stage: ProjectImportStage; onCancel?: () => void }) {
  return createPortal(<div className="project-import-status" role="status" aria-live="polite">
    <span>{msg(`projectImport.${stage}`)}</span>
    {onCancel && <button type="button" disabled={stage === 'saving'} onClick={onCancel}>{msg('projectImport.cancel')}</button>}
  </div>, document.body);
}
