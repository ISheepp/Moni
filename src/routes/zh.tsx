import { createFileRoute } from '@tanstack/react-router';
import { MoniApp } from '@/components/moni-app';
import { appSearch } from './index';

export const Route = createFileRoute('/zh')({
  validateSearch: appSearch,
  head: () => ({
    meta: [{ title: 'Moni' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: () => {
    const search = Route.useSearch();
    return (
      <MoniApp
        initialLocale="zh"
        view={search.view}
        entryId={search.entry}
        editing={search.edit}
        panel={search.panel}
        filters={search.filters}
        report={search.report}
        threadId={search.thread}
      />
    );
  },
});
