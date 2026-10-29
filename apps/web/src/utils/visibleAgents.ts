import type { AgentInfo } from '../types';
import { isPdlcMode } from '../pdlc/config';

const HIDDEN_LOCAL_CLI_AGENT_IDS = new Set(['byok-opencode']);

export function isVisibleLocalCliAgent(agent: Pick<AgentInfo, 'id'>): boolean {
  // PDLC uses Central Auth; its daemon does not enable OpenDesign Cloud identity.
  return !HIDDEN_LOCAL_CLI_AGENT_IDS.has(agent.id) && !(isPdlcMode() && agent.id === 'amr');
}

/**
 * How many detected agents the picker will actually present as usable.
 *
 * Counting the raw detection list instead would include agents that are
 * deliberately hidden from the UI, so a rescan could announce more CLIs than
 * the list beneath it ever renders — "3 available" above a list of two.
 */
export function availableVisibleAgentCount(agents: AgentInfo[]): number {
  return agents.filter((agent) => isVisibleLocalCliAgent(agent) && agent.available)
    .length;
}

export function deepSeekHarnessNeedsSetup(agent: AgentInfo): boolean {
  return (
    agent.id === 'deepseek-harness' &&
    !agent.available &&
    Boolean(agent.path) &&
    Boolean(
      agent.diagnostics?.some(
        (diagnostic) => diagnostic.reason === 'runtime-profile-incompatible',
      ),
    )
  );
}
