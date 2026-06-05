export function hasHttpScheme(url: string) {
  return new RegExp('^http(s)?://', 'i').test(url);
}

export function includeBaseUrl(url: string, baseUrl: string | null) {
  if (!baseUrl) {
    return false;
  }
  return new RegExp(`^${baseUrl.replace(/\/$/, '')}`, 'i').test(url);
}