import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { LoginPage } from '@/components/login-page';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({
    lang: z.enum(['en', 'zh']).optional().catch(undefined),
    returnTo: z.string().max(2048).optional().catch(undefined),
  }),
  head: () => ({
    meta: [{ title: 'Moni' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => {
    const search = Route.useSearch();
    return <LoginPage initialLocale={search.lang} returnTo={search.returnTo} />;
  },
});
