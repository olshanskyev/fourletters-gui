export interface AppSettings {
  language: string;
  sessionCorrelationId?: string;
  lastUserId?: string;
  pushBannerDismissed?: boolean;
}

export const defaults: AppSettings = {
  language: 'auto',
};
