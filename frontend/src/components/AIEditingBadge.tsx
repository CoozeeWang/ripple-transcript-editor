import {useContext} from 'react';
import {ConnectorContext} from '../hooks/connectorContext';
import {blocksHumanEditing,visibleAIActivities} from '../lib/aiEditOwnership';
import {msg,useInterfaceLanguage} from '../i18n';
export function AIEditingBadge({project,interview,recording,version}:{project:string;interview:string;recording:string;version:string}){
 useInterfaceLanguage();const connector=useContext(ConnectorContext);
 const task=visibleAIActivities(connector?.state.activities??[]).find(t=>t.target?.project_id===project&&t.target.interview_id===interview&&t.target.recording_id===recording&&t.version_id===version);
 if(!task||!blocksHumanEditing(task))return null;
 const confirming=task.state==='ended'&&task.inFlight>0&&['user_ended','user_cancelled'].includes(task.reason??'');
 const status=confirming?'badgeConfirming':task.state==='failed'||task.reason==='failure'||task.requestStatus==='failed'?'badgeFailed':/^connection_|task_timeout/.test(task.reason??'')||task.requestStatus==='waiting'||task.state==='ended'||task.state==='completed'?'badgeWaiting':task.state==='paused'?'badgePaused':'badgeWorking';
 return <span className="ai-editing-badge" role="status">{msg(`aiEditing.${status}`)}</span>;
}
