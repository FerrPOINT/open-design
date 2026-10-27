import { forwardRef, type ComponentProps } from 'react';
import * as Base from '@pdlc/ui/ui';
import * as Standalone from '@open-design/components';

export * from '@open-design/components';
const platform = () => typeof window !== 'undefined' && Boolean(window.__OD_PDLC_CONFIG__);

/** Compatibility for existing product props; all platform interaction mechanics stay in Base. */
export const Button = forwardRef<HTMLButtonElement, Standalone.ButtonProps>(function Button(props, ref) {
  if (!platform()) return <Standalone.Button {...props} ref={ref} />;
  const { variant = 'default', size = 'default', type = 'button', ...rest } = props;
  const variants = { default: 'secondary', primary: 'default', 'primary-ghost': 'ghost',
    ghost: 'ghost', subtle: 'ghost', secondary: 'secondary' } as const;
  return <Base.Button {...rest} type={type} variant={variants[variant]} size={size} ref={ref} />;
});
export const Input = forwardRef<HTMLInputElement, Standalone.InputProps>(function Input(props, ref) {
  if (!platform() || ['file', 'hidden', 'color', 'range'].includes(props.type ?? 'text')) {
    return <Standalone.Input {...props} ref={ref} />;
  }
  const { type, ...rest } = props;
  if (type === 'checkbox') return <Base.Checkbox {...rest} ref={ref} />;
  if (type === 'radio') return <Base.Radio {...rest} ref={ref} />;
  return <Base.Input {...props} ref={ref} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, Standalone.TextareaProps>(function Textarea(props, ref) {
  return platform() ? <Base.Textarea {...props} ref={ref} /> : <Standalone.Textarea {...props} ref={ref} />;
});
/** Previously native product fields retain native standalone semantics. */
type NativeButtonProps = Omit<Standalone.ButtonProps, 'variant'> & Pick<ComponentProps<typeof Base.Button>, 'variant'>;
export const NativeButton = forwardRef<HTMLButtonElement, NativeButtonProps>(function NativeButton(props, ref) {
  if (platform()) return <Base.Button {...props} type={props.type ?? 'submit'} variant={props.variant ?? 'ghost'} size={props.size} ref={ref} />;
  const { variant: _variant, size: _size, ...native } = props;
  return <button {...native} ref={ref} />;
});
export const NativeInput = forwardRef<HTMLInputElement, Standalone.InputProps>(function NativeInput(props, ref) {
  return platform() ? <Input {...props} ref={ref} /> : <input {...props} ref={ref} />;
});
export const NativeTextarea = forwardRef<HTMLTextAreaElement, Standalone.TextareaProps>(function NativeTextarea(props, ref) {
  return platform() ? <Textarea {...props} ref={ref} /> : <textarea {...props} ref={ref} />;
});
export function Dialog(props: Standalone.DialogProps) {
  if (!platform()) return <Standalone.Dialog {...props} />;
  const { children, onClose, className, layout, ariaLabel, ariaLabelledBy, ariaDescribedBy,
    closeOnBackdrop = true, closeOnEscape = false, as, onSubmit, id, role = 'dialog',
    backdropClassName: _backdrop, includeChromeClassName: _chrome, ...dataAttributes } = props;
  return <Base.Dialog open onOpenChange={open => { if (!open) onClose?.(); }}>
    <Base.DialogContent {...dataAttributes} id={id} className={className} layout={layout === 'sectioned' ? 'sectioned' : 'padded'}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {})}
      {...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {})}
      role={role} closeDisabled={!onClose}
      onEscapeKeyDown={event => { if (!closeOnEscape) event.preventDefault(); }}
      onInteractOutside={event => { if (!closeOnBackdrop) event.preventDefault(); }}>
      {as === 'form' ? <form onSubmit={onSubmit}>{children}</form> : children}
    </Base.DialogContent>
  </Base.Dialog>;
}
export function DialogHeader(props: ComponentProps<typeof Standalone.DialogHeader>) {
  return platform() ? <Base.DialogHeader {...props} /> : <Standalone.DialogHeader {...props} />;
}
export function DialogBody(props: ComponentProps<typeof Standalone.DialogBody>) {
  return platform() ? <Base.DialogBody {...props} /> : <Standalone.DialogBody {...props} />;
}
export function DialogFooter(props: ComponentProps<typeof Standalone.DialogFooter>) {
  return platform() ? <Base.DialogFooter {...props} /> : <Standalone.DialogFooter {...props} />;
}
export function DialogTitle(props: ComponentProps<typeof Standalone.DialogTitle>) {
  return platform() ? <Base.DialogTitle {...props} /> : <Standalone.DialogTitle {...props} />;
}
export function DialogDescription(props: ComponentProps<typeof Standalone.DialogDescription>) {
  return platform() ? <Base.DialogDescription {...props} /> : <Standalone.DialogDescription {...props} />;
}
