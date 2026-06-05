export interface AppSettings {
  language: string;
  sessionId?: string;
}

export const defaults: AppSettings = {
  language: 'auto',
};
