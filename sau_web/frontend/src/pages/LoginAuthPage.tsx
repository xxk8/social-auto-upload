import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'motion/react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { ROUTES } from '@/routes'
import { Loader2, Mail, ShieldCheck, ArrowLeft, Globe, GitBranch, CheckCircle, ArrowUpRight, Copy, Lock } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { authApi } from '@/features/auth/authApi'
import { useToast } from '@/components/ui/toast'
import { toneTextClass } from '@/lib/tone'
import { cn } from '@/lib/utils'

// ── Brand block: project URL pill (round-design-polish) ──────────────────
//
// Mirrors `SAU_PUBLIC_URL` on the backend (verified in `web_runner/routes/
// auth.py::_public_url`). Kept in lockstep via the shared default
// `http://localhost:5180` — when either side gets a real domain, both
// env vars (backend: `SAU_PUBLIC_URL`, frontend: `VITE_PUBLIC_URL`) must
// be updated in the same deployment configuration so the in-app URL
// matches what the verification-code email says. Drift between the two
// would defeat the whole "丢线索后可执行的找回入口" guarantee.
//
// The pill is click-to-copy so the user can grab the URL on demand — same
// affordance the email gives them, but offered during login flow itself
// (covers the case where email is delayed / 丢失). Toast on copy
// success mirrors the codebase's other copy-to-clipboard surfaces.
const PUBLIC_URL =
  (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? 'http://localhost:5180'
// 2 × π × r (r=6) — pre-computed stroke length for the resend countdown
// SVG so the render path stays allocation-free.
const COUNTDOWN_RING_CIRCUMFERENCE = 2 * Math.PI * 6

// ── Auth form (`/login/auth`) ────────────────────────────────────────────
//
// Moved from `src/features/auth/LoginPage.tsx` in round 12 to a
// page-level path under `/login/auth`. The visitor-facing /login
// pitch lives at `/login` and forwards `?plan=` / `?intent=` query
// params through to this page so deep-link CTAs from PricingPage
// (`/login/auth?plan=team`) keep their tier preset all the way
// through the auth flow.
//
// Behavior preserved verbatim — this is the same zod-resolved
// email → 6-digit code two-step flow as before. The `useEffect`
// redirect path (`/dashboard/publish`) is unchanged.

// NOTE: `/login/auth`'s path had previously been mounted at `/login`
// (single-route), so any in-app `navigate({ to: '/login' })` callers should
// be aware that anonymous visitors now hit the visitor pitch first.
// This page no longer needs to redirect on mount because the existing
// `useAuth` already paints the authed state into AppShell's
// AuthGuard — but we keep the early-return trip as a defensive
// guard for direct URL hits.

const emailSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
})
type EmailForm = z.infer<typeof emailSchema>

const codeSchema = z.object({
  code: z.string().length(6, '验证码为 6 位数字').regex(/^\d+$/, '验证码为纯数字'),
})
type CodeForm = z.infer<typeof codeSchema>

const passwordSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
})
type PasswordForm = z.infer<typeof passwordSchema>

export default function LoginAuthPage() {
  const navigate = useNavigate()
  const { sendCode, login, loginByPassword, isAuthenticated, sendCodeStatus, loginStatus, loginByPasswordStatus } = useAuth()
  const { addToast } = useToast()
  const [searchParams] = useSearchParams()
  const [authMode, setAuthMode] = useState<'code' | 'password'>('code')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // round-login-redirect-delay: between a successful `login()` and the
  // actual `navigate({ to: )` as never }) so the redirect doesn't feel abrupt on
  // fast localhost.
  //
  // The ref MUST be set synchronously BEFORE `await login()` so the
  // auth state flip (which `useAuth.loginMutation.onSuccess` triggers
  // via `store.setUser` *during* the await) doesn't sneak through the
  // redirect useEffect on the first commit. A `useState` here is
  // racy: `setPendingRedirect(true)` is async, so React could commit
  // `isAuthenticated=true` first and the useEffect would fire
  // immediately. A ref flips synchronously without re-render, so
  // the effect's check sees the suppression flag from the start.
  const isHandlingLoginRef = useRef(false)
  // Drives the button's "✓ 登录成功" label + the disabled state. Pure
  // UI state — not consulted by the redirect effect, only by render.
  const [successWait, setSuccessWait] = useState(false)
  // Captures the 2s setTimeout handle so the unmount cleanup can
  // cancel it — otherwise a user navigating away mid-wait would be
  // yanked back to /dashboard/publish 2s later.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema) })
  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })

  /**
   * Stable, reusable countdown timer — referenced by both the email-step's
   * "send code" success path and the code-step's "重新发送" button. The
   * `timer` closure is intentionally captured by the setInterval callback
   * (no useRef needed); the `setCountdown(prev => ...)` updater reads the
   * latest countdown without staleness. useCallback with `[]` deps keeps
   * continuity across re-renders so the same timer reference is threaded
   * through rhf's `handleSubmit` lifecycle.
   *
   * MUST stay above any conditional return so `react-hooks/rules-of-hooks`
   * sees a stable hook order (see the eslint-disable comment further down —
   * the entire early-return-after-conditional-block pattern is forbidden).
   */
  const startCountdown = useCallback(() => {
    setCountdown(60)
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  /**
   * Bounce authed visitors to the dashboard. Two paths converge here:
   *   1. already-authed user visits /login/auth directly   (mount-time trip)
   *   2. user submits valid code                            (login() flips isAuthenticated)
   *
   * useEffect is the correct shape (vs. calling navigate during render):
   *   - Hook order stays stable above the conditional return.
   *   - The redirect fires exactly once per flip (deps `[isAuthenticated, navigate]`).
   *   - React's commit phase guarantees the navigation happens with the
   *     latest state, so we don't end up navigating from a stale render.
   *
   * `/dashboard/publish` is the canonical entry point — `/` redirects to `/app`
   * via the outer Routes table, and the wizard is the primary workflow.
   */
  // OAuth callback error display
  useEffect(() => {
    const err = searchParams.get('error')
    if (err) {
      const msg: Record<string, string> = {
        google_failed: 'Google 登录失败，请重试',
        github_failed: 'GitHub 登录失败，请重试',
        no_email: '无法获取邮箱地址，请使用其他登录方式',
        oauth_not_configured: '社交登录未配置',
      }
      setError(msg[err] || `登录错误: ${err}`)
    }
  }, [searchParams])

  useEffect(() => {
    if (isAuthenticated && !isHandlingLoginRef.current) {
      const reason = searchParams.get('reason')
      const dest = reason === 'session_expired'
        ? ROUTES.dashboard.publish
        : (searchParams.get('redirect') || ROUTES.dashboard.publish)
      navigate({ to: dest as never })
    }
  }, [isAuthenticated, navigate, searchParams])

  // Cancel any in-flight redirect timeout on unmount so a Back-button
  // mid-wait doesn't hijack the user back to /dashboard/publish 2s later.
  // Also reset successWait so a user who navigates Back during the
  // 2s window lands on a clean form (button shows "登录", not the
  // stale "✓ 登录成功" disabled state).
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = null
      }
      setSuccessWait(false)
    }
  }, [])

  if (isAuthenticated && !isHandlingLoginRef.current) return null

  const handleSendCode = emailForm.handleSubmit(async (data) => {
    setError(null)
    try {
      const result = await sendCode(data.email)
      if (result.success) {
        setEmail(data.email)
        setStep('code')
        startCountdown()
      } else {
        setError(result.message || '发送失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setError(msg || '发送验证码失败')
    }
  })

  const handleLogin = codeForm.handleSubmit(async (data) => {
    setError(null)
    // Flip the suppression flag SYNCHRONOUSLY before the await so
    // the auth state flip (which `useAuth.loginMutation.onSuccess`
    // runs inside the await) can't sneak through the redirect
    // useEffect on the first commit.
    isHandlingLoginRef.current = true
    try {
      const result = await login(email, data.code)
      if (result.success) {
        // Show 2s of visible success feedback before swapping pages.
        setSuccessWait(true)
        addToast('登录成功，正在跳转…', 'success')
        redirectTimerRef.current = setTimeout(() => {
          redirectTimerRef.current = null
          const reason = searchParams.get('reason')
          const dest = reason === 'session_expired'
            ? ROUTES.dashboard.publish
            : (searchParams.get('redirect') || ROUTES.dashboard.publish)
          navigate({ to: dest as never })
        }, 2000)
      } else {
        setError(result.message || '登录失败')
        // Reset the suppression flag so a future successful attempt
        // doesn't get auto-suppressed by a leaked flag.
        isHandlingLoginRef.current = false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setError(msg || '登录失败')
      isHandlingLoginRef.current = false
    }
  })

  const handlePasswordLogin = passwordForm.handleSubmit(async (data) => {
    setError(null)
    isHandlingLoginRef.current = true
    try {
      const result = await loginByPassword(data.email, data.password)
      if (result.success) {
        setSuccessWait(true)
        addToast('登录成功，正在跳转…', 'success')
        redirectTimerRef.current = setTimeout(() => {
          redirectTimerRef.current = null
          const reason = searchParams.get('reason')
          const dest = reason === 'session_expired'
            ? ROUTES.dashboard.publish
            : (searchParams.get('redirect') || ROUTES.dashboard.publish)
          navigate({ to: dest as never })
        }, 2000)
      } else {
        setError(result.message || '登录失败')
        isHandlingLoginRef.current = false
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setError(msg || '登录失败')
      isHandlingLoginRef.current = false
    }
  })

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
      {/* Background decorative grid (foreground dot pattern) — keeps a
          subtle texture without the decorative blur-3xl orbs that
          previously anchored this surface. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: `radial-gradient(var(--foreground) 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* Logo & Brand */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mb-8 flex flex-col items-center"
        >
          <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-[3px] bg-foreground">
            <span aria-hidden className="font-mono text-[18px] font-medium leading-none tracking-tight text-background">{'>_'}</span>
          </div>
          <h1
            className="font-mono text-xl font-medium tracking-tight text-foreground"
            style={{ fontFamily: 'var(--font-jetbrains-mono)' }}
          >
            {'sau@main'}
          </h1>
          <button
            type="button"
            onClick={() => {
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(PUBLIC_URL).then(
                  () => addToast('项目链接已复制', 'success'),
                  () => {/* clipboard API blocked silently — no toast */},
                )
              }
            }}
            className="mt-2 group inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.04] hover:text-foreground"
            aria-label={`复制项目链接 ${PUBLIC_URL}`}
            title="点击复制"
          >
            <ArrowUpRight className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
            <span>{PUBLIC_URL}</span>
            <Copy className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
          </button>
        </motion.div>

        {/* Card */}
        <Card className="border-border/60 shadow-xl shadow-black/[0.04] dark:shadow-black/20">
          <CardContent className="p-6 sm:p-8">
            {/* ── Step indicator (only for code auth mode) ── */}
            {authMode === 'code' && (
              <ol
                aria-label="登录流程进度"
                className="mb-6 flex items-center gap-2 font-mono text-[11px]"
              >
                {([
                  { key: 'email', label: '邮箱', n: 1 },
                  { key: 'code',  label: '验证码', n: 2 },
                ] as const).map((s, i) => {
                  const isActive = step === s.key
                  return (
                    <li key={s.key} className="flex items-center gap-2">
                      <span
                        aria-current={isActive ? 'step' : undefined}
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-full border tabular-nums transition-colors',
                          isActive
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-muted-foreground',
                        )}
                      >
                        {s.n}
                      </span>
                      <span
                        className={cn(
                          'transition-colors',
                          isActive ? 'text-foreground' : 'text-muted-foreground/70',
                        )}
                      >
                        {s.label}
                      </span>
                      {i === 0 && (
                        <span aria-hidden className="ml-1 h-px w-8 bg-border" />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}

            {/* ── Social login buttons ── */}
            <div className="space-y-3 mb-5">
              <Button
                variant="outline"
                className="w-full h-11 text-sm font-medium"
                onClick={() => authApi.googleLogin()}
                type="button"
              >
                <Globe className="mr-2 h-4 w-4" />
                Google 登录
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 text-sm font-medium"
                onClick={() => authApi.githubLogin()}
                type="button"
              >
                <GitBranch className="mr-2 h-4 w-4" />
                GitHub 登录
              </Button>
            </div>

            <div className="relative mb-5">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">或者</span>
              </div>
            </div>

            {/* Tab switcher: code vs password */}
            <div className="mb-5 flex rounded-lg border border-border bg-muted/30 p-1">
              <button
                type="button"
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  authMode === 'code'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => { setAuthMode('code'); setError(null) }}
              >
                验证码登录
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  authMode === 'password'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => { setAuthMode('password'); setError(null) }}
              >
                密码登录
              </button>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-5 overflow-hidden"
                >
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {authMode === 'code' ? (
                <motion.div
                  key="code-auth"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  {step === 'email' ? (
                    <form onSubmit={handleSendCode} className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-sm font-medium">
                          邮箱地址
                        </Label>
                        <div className="group relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            className="h-11 pl-10 text-sm"
                            autoComplete="email"
                            inputMode="email"
                            {...emailForm.register('email')}
                          />
                        </div>
                        {emailForm.formState.errors.email && (
                          <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-destructive"
                          >
                            {emailForm.formState.errors.email.message}
                          </motion.p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="h-11 w-full text-sm font-medium"
                        disabled={sendCodeStatus === 'pending'}
                      >
                        {sendCodeStatus === 'pending' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            发送中…
                          </>
                        ) : (
                          '发送验证码'
                        )}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleLogin} className="space-y-5">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="code" className="text-sm font-medium">
                            验证码
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            已发送至 <span className="font-medium text-foreground">{email}</span>
                          </span>
                        </div>
                        <div className="group relative">
                          <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <Input
                            id="code"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="6 位验证码"
                            className="h-11 pl-10 text-center font-mono text-lg tracking-[0.3em]"
                            autoComplete="one-time-code"
                            autoFocus
                            {...codeForm.register('code')}
                          />
                        </div>
                        {codeForm.formState.errors.code && (
                          <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-destructive"
                          >
                            {codeForm.formState.errors.code.message}
                          </motion.p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="h-11 w-full text-sm font-medium"
                        disabled={loginStatus === 'pending' || successWait}
                      >
                        {loginStatus === 'pending' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            登录中…
                          </>
                        ) : successWait ? (
                          <>
                            <CheckCircle className={cn('mr-2 h-4 w-4', toneTextClass('success'))} />
                            登录成功
                          </>
                        ) : (
                          '登录'
                        )}
                      </Button>

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => {
                            setStep('email')
                            setError(null)
                            codeForm.reset()
                          }}
                        >
                          <ArrowLeft className="h-3 w-3" />
                          更换邮箱
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                          disabled={countdown > 0}
                          onClick={handleSendCode}
                        >
                          {countdown > 0 ? (
                            <>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                className="-rotate-90"
                                aria-hidden
                              >
                                <circle
                                  cx="8"
                                  cy="8"
                                  r="6"
                                  stroke="currentColor"
                                  strokeOpacity="0.2"
                                  strokeWidth="2"
                                  fill="none"
                                />
                                <circle
                                  cx="8"
                                  cy="8"
                                  r="6"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  fill="none"
                                  strokeLinecap="round"
                                  strokeDasharray={COUNTDOWN_RING_CIRCUMFERENCE}
                                  strokeDashoffset={
                                    COUNTDOWN_RING_CIRCUMFERENCE * (1 - countdown / 60)
                                  }
                                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                                />
                              </svg>
                              <span className="tabular-nums">{countdown}s 后重发</span>
                            </>
                          ) : (
                            '重新发送'
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </motion.div>
              ) : (
                <motion.form
                  key="password-auth"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  onSubmit={handlePasswordLogin}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <Label htmlFor="pw-email" className="text-sm font-medium">
                      邮箱地址
                    </Label>
                    <div className="group relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="pw-email"
                        type="email"
                        placeholder="you@example.com"
                        className="h-11 pl-10 text-sm"
                        autoComplete="email"
                        inputMode="email"
                        {...passwordForm.register('email')}
                      />
                    </div>
                    {passwordForm.formState.errors.email && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-destructive"
                      >
                        {passwordForm.formState.errors.email.message}
                      </motion.p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pw-password" className="text-sm font-medium">
                        密码
                      </Label>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                        onClick={() => navigate({ to: `/login/forgot-password?email=${encodeURIComponent(passwordForm.watch('email') || '')}` as never })}
                      >
                        忘记密码？
                      </button>
                    </div>
                    <div className="group relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="pw-password"
                        type="password"
                        placeholder="输入密码"
                        className="h-11 pl-10 text-sm"
                        autoComplete="current-password"
                        {...passwordForm.register('password')}
                      />
                    </div>
                    {passwordForm.formState.errors.password && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-destructive"
                      >
                        {passwordForm.formState.errors.password.message}
                      </motion.p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="h-11 w-full text-sm font-medium"
                    disabled={loginByPasswordStatus === 'pending' || successWait}
                  >
                    {loginByPasswordStatus === 'pending' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        登录中…
                      </>
                    ) : successWait ? (
                      <>
                        <CheckCircle className={cn('mr-2 h-4 w-4', toneTextClass('success'))} />
                        登录成功
                      </>
                    ) : (
                      '登录'
                    )}
                  </Button>
                </motion.form>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 text-center text-xs text-muted-foreground/60"
        >
          登录即表示同意我们的服务条款和隐私政策
        </motion.p>
      </motion.div>
    </div>
  )
}
