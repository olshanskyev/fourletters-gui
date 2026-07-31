import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// In production the runtime values live in a non-fingerprinted config.json that the container
// entrypoint substitutes at startup. Loading it here (before bootstrap) keeps the values out of
// the service-worker-hashed bundles, so ngsw.json hashes stay valid and updates can install.
async function loadRuntimeConfig(): Promise<void> {
  if (!environment.production) return;
  try {
    const response = await fetch('config.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const config = await response.json();
    Object.assign(environment, { ...config, vkAppId: Number(config.vkAppId) });
  } catch (err) {
    console.error('Failed to load runtime config', err);
  }
}

loadRuntimeConfig().then(() =>
  bootstrapApplication(App, appConfig).catch((err) => console.error(err)),
);
