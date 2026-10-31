import {pendingWriteControl} from '../lib/pendingWriteControl';
import { useContext, type ComponentProps } from 'react';
import { TagWritingContext } from '../lib/tagCandidates';

/** The editing guard updates the small control, not every paragraph/card in a long manuscript. */
export function TagAddButton(props: ComponentProps<'button'>) {
    const writing = useContext(TagWritingContext);
    return <button {...props} {...pendingWriteControl(props.disabled,writing)}/>;
}
