import type { ComponentProps } from 'react';
import { CustomSelect } from '../components/CustomSelect';

/** Adapt existing native fields to Base in PDLC; standalone keeps its native form behavior. */
export function SelectField(props: ComponentProps<typeof CustomSelect>) {
  if (typeof window !== 'undefined' && window.__OD_PDLC_CONFIG__) return <CustomSelect {...props} />;
  return <select id={props.id} aria-label={props.ariaLabel} aria-labelledby={props.labelledBy}
    value={props.value} disabled={props.disabled} title={props.title} onFocus={props.onFocus}
    className={props.className} onChange={event => props.onChange(event.target.value)}>
    {props.options.map(item => 'options' in item
      ? <optgroup key={item.label} label={item.label}>{item.options.map(option =>
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</optgroup>
      : <option key={item.value} value={item.value} disabled={item.disabled}>{item.label}</option>)}
  </select>;
}
