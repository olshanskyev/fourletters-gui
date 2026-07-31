// Runtime values are loaded at startup from config.json (see main.ts) and
// substituted by the container entrypoint, so they are intentionally left empty here.
export const environment = {
  production: true,
  baseUrlServer: '',
  baseUrlHub: '',
  useHash: false,
  vkAppId: 0,
  googleClientId: '',
  redirectUrl: '',
  standalone: false,
  umamiWebsiteId: '',
  vapidPublicKey: ''
};
