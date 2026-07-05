import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'motion/react'
import { Card, CardContent } from '@/Components/ui/card'
import { Input } from '@/Components/ui/input'
import { Button } from '@/Components/ui/button'
import { Label } from '@/Components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { Loader2, Mail, ShieldCheck, ArrowLeft } from 'lucide-react'

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
// redirect path (`/app/publish`) is unchanged.

// NOTE: `/login/auth`'s path had previously been mounted at `/login`
// (single-route), so any in-app `navigate('/login')` callers should
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

export default function LoginAuthPage() {
  const navigate = useNavigate()
  const { sendCode, login, isAuthenticated, sendCodeStatus, loginStatus } = useAuth()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema) })

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
   * `/app/publish` is the canonical entry point — `/` redirects to `/app`
   * via the outer Routes table, and the wizard is the primary workflow.
   */
  useEffect(() => {
    if (isAuthenticated) navigate('/app/publish', { replace: true })
  }, [isAuthenticated, navigate])

  if (isAuthenticated) return null

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
    try {
      const result = await login(email, data.code)
      if (result.success) {
        // The useEffect above handles the redirect once `isAuthenticated`
        // flips true; we deliberately don't `navigate()` here — that would
        // double-fire and clobber the effect's replace semantics.
      } else {
        setError(result.message || '登录失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setError(msg || '登录失败')
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
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/80 tabular-nums">
            build a7f3b21 · mainline
          </p>
        </motion.div>

        {/* Card */}
        <Card className="border-border/60 shadow-xl shadow-black/[0.04] dark:shadow-black/20">
          <CardContent className="p-6 sm:p-8">
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
              {step === 'email' ? (
                <motion.form
                  key="email-step"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  onSubmit={handleSendCode}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">
                      邮箱地址
                    </Label>
                    <div className="group relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="email"
                        name="email"
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
                </motion.form>
              ) : (
                <motion.form
                  key="code-step"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-5"
                >
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
                        name="code"
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
                    disabled={loginStatus === 'pending'}
                  >
                    {loginStatus === 'pending' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        登录中…
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
                      className="text-xs font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                      disabled={countdown > 0}
                      onClick={handleSendCode}
                    >
                      {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                    </button>
                  </div>
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
