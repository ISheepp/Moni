import { IconLock, IconLogout } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { loginLocation } from '@/lib/auth-navigation';
import { privateApi } from '@/lib/client-api';
import { type AppLocale, message } from '@/lib/locale';

export function AuthenticationSettings({ locale }: { locale: AppLocale }) {
  const [mode, setMode] = useState<'password' | 'access' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  useEffect(() => {
    const controller = new AbortController();
    privateApi<{ mode: 'password' | 'access' }>(
      'auth',
      undefined,
      'GET',
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setMode(result.mode);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <section
      aria-labelledby="authentication-title"
      className="mt-6 space-y-4 rounded-2xl border border-foreground/40 bg-surface p-4 text-left md:p-6"
    >
      <h2
        id="authentication-title"
        className="flex items-center gap-2 text-lg font-extrabold"
      >
        <IconLock size={21} aria-hidden />
        {t('login_access_title')}
      </h2>
      {mode && (
        <>
          <p className="font-bold">
            {mode === 'access' ? 'Cloudflare Access' : t('login_password')}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(mode === 'access' ? 'login_access_hint' : 'login_password_hint')}
          </p>
        </>
      )}
      {mode === 'access' ? (
        <a
          href="/cdn-cgi/access/logout"
          className={buttonVariants({ variant: 'plain' })}
        >
          <IconLogout size={18} aria-hidden />
          {t('login_sign_out')}
        </a>
      ) : (
        <Button
          variant="plain"
          disabled={!mode || busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError(false);
            try {
              await privateApi('auth/logout', {});
              window.location.replace(
                loginLocation(locale === 'zh' ? '/zh' : '/', locale)
              );
            } catch {
              setError(true);
              setBusy(false);
            }
          }}
        >
          <IconLogout size={18} aria-hidden />
          {t('login_sign_out')}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {t('login_unavailable')}
        </p>
      )}
    </section>
  );
}
