import { useSyncExternalStore } from 'react';
import { isPdlcMode } from './config';

let selected = '';
const listeners = new Set<() => void>();
export function selectedTrackerProject(): string { return selected; }
export function setTrackerProject(id: string): void {
  if (id === selected) return;
  selected = id;
  for (const listener of listeners) listener();
}
export function useTrackerProject(): string {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, selectedTrackerProject, () => '');
}
export function trackerProjectQuery(): string {
  return isPdlcMode() ? `?trackerProjectId=${encodeURIComponent(selected || 'none')}` : '';
}
export function trackerProjectHeaders(): Record<string, string> {
  return isPdlcMode() && selected ? { 'X-PDLC-Tracker-Project': selected } : {};
}
