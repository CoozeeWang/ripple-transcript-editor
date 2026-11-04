import {pendingWriteControl} from '../lib/pendingWriteControl';
import { useContext, type ComponentProps } from 'react';
import { blockTagWrite, TagWritingContext } from '../lib/tagCandidates';

/** Real disabled states remain native; short writes are checked at the action boundary. */
export function TagAddButton(props: ComponentProps<'button'>) {
    const writing = useContext(TagWritingContext);
    return <button {...props} {...pendingWriteControl(props.disabled,typeof writing==='boolean'&&writing)}
        onClick={event=>{if(!blockTagWrite(writing,event))props.onClick?.(event)}}
        onKeyDown={event=>{if((event.key==='Enter'||event.key===' ')&&blockTagWrite(writing,event))return;props.onKeyDown?.(event)}}/>;
}
