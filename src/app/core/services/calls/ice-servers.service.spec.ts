import { environment } from '@env/environment';
import { IceServersService } from './ice-servers.service';

describe('IceServersService', () => {
  const original = environment.stunUrls;
  const service = new IceServersService();

  afterEach(() => {
    environment.stunUrls = original;
  });

  it('turns the comma-separated config into one ICE server entry', async () => {
    environment.stunUrls = 'stun:a.example:3478, stun:b.example:3478';

    expect(await service.getIceServers())
      .toEqual([{ urls: ['stun:a.example:3478', 'stun:b.example:3478'] }]);
  });

  it('ignores blanks and an unsubstituted placeholder', async () => {
    environment.stunUrls = '__STUN_URLS__, ';

    expect(await service.getIceServers()).toEqual([]);
  });
});
