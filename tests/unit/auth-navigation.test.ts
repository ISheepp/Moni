import { expect, it } from 'vitest';
import { loginLocation, safeReturnTo } from '../../src/lib/auth-navigation';

it('preserves only internal application destinations and prevents login redirect loops', () => {
  for (const value of [
    undefined,
    null,
    '',
    '//untrusted.test',
    '/\\untrusted.test',
    'https://untrusted.test',
    '/login',
    '/assets/private',
    '/%2f%2funtrusted.test',
    '/'.repeat(3000),
  ])
    expect(safeReturnTo(value)).toBe('/');
  expect(safeReturnTo('/?view=entries&entry=synthetic')).toBe(
    '/?view=entries&entry=synthetic'
  );
  expect(safeReturnTo('/zh?view=reports')).toBe('/zh?view=reports');
  expect(loginLocation('/zh?view=reports')).toBe(
    '/login?returnTo=%2Fzh%3Fview%3Dreports&lang=zh'
  );
});
