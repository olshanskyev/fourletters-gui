export interface AppSettings {
  language: string;
  sessionCorrelationId?: string;
  lastUserId?: string;
}

export const defaults: AppSettings = {
  language: 'auto',
};
