import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, afterEach, it, expect } from 'vitest';

import { BASE_URL_SERVER, baseUrlInterceptor } from './base-url-interceptor';

describe('BaseUrlInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  const baseUrlServer = 'https://foo.bar';

  const setBaseUrl = (url: string | null) => {
    TestBed.overrideProvider(BASE_URL_SERVER, { useValue: url });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: BASE_URL_SERVER, useValue: null },
        provideHttpClient(withInterceptors([baseUrlInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => httpMock.verify());

  it('should not prepend base url when base url is empty', () => {
    setBaseUrl(null);

    http.get('/user').subscribe(data => expect(data).toEqual({ success: true }));

    httpMock.expectOne('/user').flush({ success: true });
  });

  it('should prepend base url when request url does not has http scheme', () => {
    setBaseUrl(baseUrlServer);

    http.get('./user').subscribe(data => expect(data).toEqual({ success: true }));
    httpMock.expectOne(baseUrlServer + '/user').flush({ success: true });

    http.get('').subscribe(data => expect(data).toEqual({ success: true }));
    httpMock.expectOne(baseUrlServer).flush({ success: true });
  });
});
