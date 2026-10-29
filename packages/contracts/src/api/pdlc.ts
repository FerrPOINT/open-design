/** Public runtime configuration. Secrets and tokens never enter this DTO. */
export interface PdlcConfiguration {
  issuer: string;
  clientId: string;
  publicOrigin: string;
  hostOrigin: string | null;
  catalogUrl: string | null;
  brandingUrl?: string | null;
  applicationKey: 'open-design';
}

export interface PdlcIdentity {
  subject: string;
  email: string;
  displayName: string;
}

export interface PdlcSessionResponse {
  identity: PdlcIdentity;
  expiresAt: number;
  /** Invalidates other studio documents; never grants identity or permissions. */
  identityChanged?: boolean;
}

/** Access to the configured model, not proof of provider inference health. */
export interface PdlcInferenceStatus {
  state: 'ready' | 'not_configured' | 'access_denied' | 'model_unavailable' | 'hub_unavailable';
  model: string | null;
}
