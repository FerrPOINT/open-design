// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, Input } from '@open-design/components';
import { CustomSelect } from '../src/components/CustomSelect';
import { TrackerProjectPicker } from '../src/pdlc/TrackerProjectPicker';
import { I18nProvider } from '../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); delete window.__OD_PDLC_CONFIG__; });

it('retains original studio buttons, checkbox events and select behavior in PDLC mode', async () => {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design', publicOrigin: 'https://design.example',
    applicationKey: 'open-design', hostOrigin: null, catalogUrl: null };
  const changed = vi.fn();
  render(<><Button variant="primary">Save</Button><Input type="checkbox" aria-label="Enabled" onChange={changed} />
    <CustomSelect value="one" options={[{value:'one',label:'One'},{value:'two',label:'Two'}]} ariaLabel="Model" onChange={changed} /></>);
  expect(screen.getByRole('button', { name: 'Save' })).not.toHaveClass('base-control');
  expect(screen.getByRole('checkbox')).toBeInstanceOf(HTMLInputElement);
  fireEvent.click(screen.getByRole('checkbox')); expect(changed).toHaveBeenCalledOnce();
  const select = screen.getByRole('combobox'); expect(select).not.toHaveClass('base-control');
  fireEvent.click(select); fireEvent.click(await screen.findByRole('option', { name: 'Two' }));
  expect(changed).toHaveBeenLastCalledWith('two');
});

it('selects only Tracker catalog projects and retains the choice in this account tab', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({projects:[
    {id:'tracker-1',key:'BASE',name:'Platform'}, {id:'tracker-2',key:'DOCS',name:'Documentation'},
  ]}))); vi.stubGlobal('fetch', fetcher);
  render(<I18nProvider initial="en"><TrackerProjectPicker subject="alice" /></I18nProvider>);
  const trigger = await screen.findByRole('button', {name:'Task Tracker project'});
  await vi.waitFor(() => expect(trigger).not.toBeDisabled());
  fireEvent.pointerDown(trigger, {button:0,ctrlKey:false});
  fireEvent.click(await screen.findByRole('menuitemradio', {name:'Documentation'}));
  await vi.waitFor(() => expect(sessionStorage.getItem('open-design:pdlc-tracker-project:alice')).toBe('tracker-2'));
  expect(trigger).toHaveTextContent('Documentation');
  expect(fetcher).toHaveBeenCalledWith('/api/pdlc/projects', expect.objectContaining({credentials:'same-origin',redirect:'error'}));
});

it('does not substitute studio projects or a saved inaccessible project for an empty Tracker catalog', async () => {
  sessionStorage.setItem('open-design:pdlc-tracker-project:bob','unavailable');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"projects":[]}')));
  render(<I18nProvider initial="en"><TrackerProjectPicker subject="bob" /></I18nProvider>);
  await screen.findByText('No accessible projects');
  expect(screen.getByRole('button', {name:'Task Tracker project'})).toBeDisabled();
  await vi.waitFor(() => expect(sessionStorage.getItem('open-design:pdlc-tracker-project:bob')).toBeNull());
});
