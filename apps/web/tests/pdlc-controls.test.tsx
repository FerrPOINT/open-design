// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, Dialog, DialogTitle, Input } from '../src/pdlc/primitives';
import { SelectField } from '../src/pdlc/select-field';

afterEach(() => { cleanup(); delete window.__OD_PDLC_CONFIG__; });
function platform() {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design',
    publicOrigin: 'https://design.example', hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
}
it('uses Base controls and preserves native checkbox events in PDLC', () => {
  platform(); const change = vi.fn();
  render(<><Button variant="primary">Save</Button><Input aria-label="Enabled" type="checkbox" checked={false} onChange={change} /></>);
  expect(screen.getByRole('button',{ name: 'Save' })).toHaveClass('base-control');
  fireEvent.click(screen.getByRole('checkbox',{ name: 'Enabled' }));
  expect(change).toHaveBeenCalledOnce();
});
it('uses Base Select with real empty IDs while standalone preserves its native field', async () => {
  const change = vi.fn(); const props = { ariaLabel: 'Model', value: '', onChange: change,
    options: [{ value: '', label: 'Default' }, { value: 'model-b', label: 'Model B' }] };
  const view = render(<SelectField {...props} />);
  expect(screen.getByRole('combobox')).toBeInstanceOf(HTMLSelectElement);
  cleanup(); platform(); render(<SelectField {...props} />);
  const field = screen.getByRole('combobox', { name: 'Model' });
  expect(field).toBeInstanceOf(HTMLButtonElement);
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: 'Model B' });
  fireEvent.keyDown(option, { key: 'Enter' });
  expect(change).toHaveBeenLastCalledWith('model-b');
  view.unmount();
});
it('keeps the Base dialog and its label rather than a product focus trap', () => {
  platform(); const close = vi.fn();
  render(<Dialog onClose={close} closeOnEscape data-testid="product-dialog"><DialogTitle>Confirm</DialogTitle><Button>Continue</Button></Dialog>);
  expect(screen.getByRole('dialog', { name: 'Confirm' })).toHaveAttribute('data-testid','product-dialog');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
