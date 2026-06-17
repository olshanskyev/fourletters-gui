export interface AppSettings {
  language: string;
  sessionId?: string;
  serverStartedAt?: number;
}

export const defaults: AppSettings = {
  language: 'auto',
};
