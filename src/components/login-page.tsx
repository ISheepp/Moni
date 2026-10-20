import { Field } from '@base-ui/react/field';
import { Form } from '@base-ui/react/form';
import { Input } from '@base-ui/react/input';
import { IconEye, IconEyeOff, IconLock } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { AppLanguageSwitcher } from '@/components/app-language-switcher';
import { ThemeSwitcher } from '@/components/layout/theme-switcher';
import { MoniBrand } from '@/components/moni-brand';
import { Button } from '@/components/ui/button';
import { useAppLocale } from '@/hooks/use-app-locale';
import { safeReturnTo } from '@/lib/auth-navigation';
import { type AppLocale, message } from '@/lib/locale';

export function LoginPage({
  initialLocale,
  returnTo,
}: {
  initialLocale?: AppLocale;
  returnTo?: string;
}) {
  const language = useAppLocale(initialLocale);
  const t = (key: Parameters<typeof message>[0]) =>
    message(key, language.locale);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [error, setError] = useState<
    'login_failed' | 'login_limited' | 'login_unavailable' | null
  >(null);
  const input = useRef<HTMLElement>(null);
  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 pb-10 text-foreground">
      <a href="#main-content" className="moni-skip">
        {t('skip_to_content')}
      </a>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 py-6">
        <MoniBrand />
        <div className="flex items-center gap-3">
          <ThemeSwitcher locale={language.locale} />
          <AppLanguageSwitcher language={language} />
        </div>
      </header>
      <main id="main-content" className="mx-auto my-auto w-full max-w-md py-8">
        <div className="mb-7 flex justify-center">
          <img
            src="/moni/illustrations/assistant-lock.png"
            alt=""
            className="h-32 w-auto object-contain"
          />
        </div>
        <section
          aria-labelledby="login-title"
          className="rounded-3xl border border-foreground/20 bg-surface p-6 shadow-sm md:p-8"
        >
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange/10 px-3 py-1 text-sm font-bold">
            <IconLock size={16} aria-hidden />
            {t('app_private_ledger')}
          </div>
          <h1 id="login-title" className="text-3xl font-extrabold">
            {t('login_title')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t('login_description')}
          </p>
          <Form
            method="post"
            className="mt-7 space-y-5"
            aria-label={t('login_title')}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                const response = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password }),
                });
                if (response.ok) {
                  setPassword('');
                  window.location.replace(safeReturnTo(returnTo));
                  return;
                }
                setError(
                  response.status === 429
                    ? 'login_limited'
                    : response.status === 401
                      ? 'login_failed'
                      : 'login_unavailable'
                );
                input.current?.focus();
              } catch {
                setError('login_unavailable');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field.Root name="password">
              <Field.Label className="mb-2 block font-bold">
                {t('login_password')}
              </Field.Label>
              <div className="relative">
                <Input
                  ref={input}
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onValueChange={setPassword}
                  autoComplete="current-password"
                  disabled={!ready || busy}
                  required
                  maxLength={128}
                  aria-invalid={error === 'login_failed'}
                  aria-describedby={error ? 'login-error' : 'login-hint'}
                  className="min-h-12 w-full rounded-xl border border-foreground/35 bg-background px-3 pr-14 outline-none focus-visible:ring-4 focus-visible:ring-focus"
                />
                <Button
                  variant="icon"
                  disabled={!ready || busy}
                  aria-label={t(
                    visible ? 'login_hide_password' : 'login_show_password'
                  )}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                  className="absolute top-0.5 right-1 border-0 bg-transparent"
                >
                  {visible ? (
                    <IconEyeOff size={20} aria-hidden />
                  ) : (
                    <IconEye size={20} aria-hidden />
                  )}
                </Button>
              </div>
              <Field.Description
                id="login-hint"
                className="mt-2 text-sm text-muted-foreground"
              >
                {t('login_session_hint')}
              </Field.Description>
            </Field.Root>
            {error && (
              <p
                id="login-error"
                role="alert"
                className="rounded-xl border border-orange/40 bg-orange/10 p-3 text-sm"
              >
                {t(error)}
              </p>
            )}
            <Button type="submit" disabled={!ready || busy} className="w-full">
              {t(busy ? 'login_signing_in' : 'login_sign_in')}
            </Button>
          </Form>
        </section>
        <p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">
          {t('login_access_optional')}{' '}
          <a
            href="https://github.com/ISheepp/Moni/blob/main/docs/deployment.md"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-4 focus-visible:outline-focus"
          >
            {t('login_deployment_guide')}
          </a>
        </p>
      </main>
    </div>
  );
}
