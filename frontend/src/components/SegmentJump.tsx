import { useId, useState, type KeyboardEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';

/** Number refers to the current manuscript's original order, including hidden speakers. */
export function SegmentJump({ count, onJump }: { count: number; onJump: (number: number) => void }) {
  useInterfaceLanguage();
  const id = useId();
  const [value, setValue] = useState('');
  const jump = (input: HTMLInputElement) => {
    const text = value.trim(), number = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || number > count) {
      input.setCustomValidity(msg('segmentJump.invalid', { count }));
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    onJump(number);
    setValue('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); jump(event.currentTarget);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setValue(''); event.currentTarget.setCustomValidity('');
    }
  };
  return <form className="segment-jump" noValidate onSubmit={event => event.preventDefault()}>
    <label htmlFor={id}>{msg('segmentJump.label')}</label>
    <input id={id} type="text" inputMode="numeric" autoComplete="off" disabled={count === 0}
      aria-label={count ? msg('segmentJump.inputLabel', { count }) : msg('segmentJump.label')} value={value} onKeyDown={onKeyDown}
      onChange={event => { event.currentTarget.setCustomValidity(''); setValue(event.target.value); }} />
  </form>;
}
