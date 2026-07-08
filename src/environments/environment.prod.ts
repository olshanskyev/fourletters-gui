export const environment = {
  production: true,
  // Placeholders replaced at container start: use names in SUBSTITUTE_VARS
  baseUrlServer: '__BASE_URL_SERVER__',
  baseUrlHub: '__BASE_URL_HUB__',
  useHash: false,
  vkAppId: '__VK_APP_ID__' as unknown as number,
  googleClientId: '__GOOGLE_CLIENT_ID__',
  redirectUrl: '__OAUTH_REDIRECT_URL__',
  standalone: false,
  umamiWebsiteId: '__UMAMI_WEBSITE_ID__',
  vapidPublicKey: '__PUSH_VAPID_PUBLIC_KEY__',
  enableServiceWorker: true
};
