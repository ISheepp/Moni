export function safeReturnTo(value: string | null | undefined) {
  if (!value || value.length > 2048 || !value.startsWith('/')) return '/';
  try {
    const url = new URL(value, 'https://moni.invalid');
    if (
      url.origin !== 'https://moni.invalid' ||
      !['/', '/zh'].includes(url.pathname)
    )
      return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

export function loginLocation(path: string, language?: string) {
  const query = new URLSearchParams({ returnTo: safeReturnTo(path) });
  if (language === 'zh' || path.startsWith('/zh')) query.set('lang', 'zh');
  return `/login?${query}`;
}
