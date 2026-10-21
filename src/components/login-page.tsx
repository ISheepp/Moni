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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setup, setSetup] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/setup', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Authentication unavailable');
        const state = await response.json();
        if (
          typeof state !== 'object' ||
          state === null ||
          !('setupRequired' in state) ||
          typeof state.setupRequired !== 'boolean'
        )
          throw new Error('Invalid setup state');
        if (!controller.signal.aborted) {
          setSetup(state.setupRequired);
          setReady(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('login_unavailable');
      });
    return () => controller.abort();
  }, []);
  const [error, setError] = useState<
    | 'login_failed'
    | 'login_limited'
    | 'login_unavailable'
    | 'setup_password_mismatch'
    | 'setup_password_invalid'
    | 'setup_already_configured'
    | null
  >(null);
  const input = useRef<HTMLElement>(null);
  const confirmation = useRef<HTMLElement>(null);
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
            {t(setup ? 'setup_title' : 'login_title')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t(setup ? 'setup_description' : 'login_description')}
          </p>
          {setup && (
            <p className="mt-4 rounded-xl border border-orange/40 bg-orange/10 p-3 text-sm leading-relaxed">
              {t('setup_owner_notice')}
            </p>
          )}
          <Form
            method="post"
            className="mt-7 space-y-5"
            aria-label={t(setup ? 'setup_title' : 'login_title')}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              if (setup && password !== confirmPassword) {
                setError('setup_password_mismatch');
                confirmation.current?.focus();
                return;
              }
              setBusy(true);
              setError(null);
              try {
                const response = await fetch(
                  setup ? '/api/auth/setup' : '/api/auth/login',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      password,
                      ...(setup ? { confirmPassword } : {}),
                    }),
                  }
                );
                if (response.ok) {
                  setPassword('');
                  setConfirmPassword('');
                  window.location.replace(safeReturnTo(returnTo));
                  return;
                }
                if (setup && response.status === 409) {
                  setSetup(false);
                  setPassword('');
                  setConfirmPassword('');
                  setError('setup_already_configured');
                  input.current?.focus();
                  return;
                }
                setError(
                  response.status === 429
                    ? 'login_limited'
                    : setup && response.status === 400
                      ? 'setup_password_invalid'
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
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  disabled={!ready || busy}
                  required
                  minLength={setup ? 15 : undefined}
                  maxLength={128}
                  aria-invalid={
                    error === 'login_failed' ||
                    error === 'setup_password_invalid'
                  }
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
                {t(setup ? 'setup_password_hint' : 'login_session_hint')}
              </Field.Description>
            </Field.Root>
            {setup && (
              <Field.Root name="confirmPassword">
                <Field.Label className="mb-2 block font-bold">
                  {t('setup_confirm_password')}
                </Field.Label>
                <Input
                  ref={confirmation}
                  type={visible ? 'text' : 'password'}
                  value={confirmPassword}
                  onValueChange={setConfirmPassword}
                  autoComplete="new-password"
                  disabled={!ready || busy}
                  required
                  minLength={15}
                  maxLength={128}
                  aria-invalid={error === 'setup_password_mismatch'}
                  aria-describedby={
                    error === 'setup_password_mismatch'
                      ? 'login-error'
                      : undefined
                  }
                  className="min-h-12 w-full rounded-xl border border-foreground/35 bg-background px-3 outline-none focus-visible:ring-4 focus-visible:ring-focus"
                />
              </Field.Root>
            )}
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
              {t(
                setup
                  ? busy
                    ? 'setup_saving'
                    : 'setup_submit'
                  : busy
                    ? 'login_signing_in'
                    : 'login_sign_in'
              )}
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
