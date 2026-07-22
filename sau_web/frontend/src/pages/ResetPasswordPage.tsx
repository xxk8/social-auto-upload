import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSearchParams } from '@/lib/router/useSearchParams'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'motion/react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ROUTES } from '@/routes'
import { Loader2, Mail, ShieldCheck, Lock, ArrowLeft, CheckCircle } from 'lucide-react'
import { authApi } from '@/features/auth/authApi'
import { cn } from '@/lib/utils'
import { toneTextClass } from '@/lib/tone'

const resetSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  code: z.string().length(6, '验证码为 6 位数字').regex(/^\d+$/, '验证码为纯数字'),
  newPassword: z.string().min(8, '密码长度不能少于 8 位').regex(/[a-zA-Z]/, '密码必须包含字母').regex(/\d/, '密码必须包含数字'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
})
type ResetForm = z.infer<typeof resetSchema>

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const form = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      email: searchParams.get('email') || '',
      code: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  const handleSubmit = form.handleSubmit(async (data) => {
    setError(null)
    setSubmitting(true)
    try {
      const result = await authApi.resetPassword(data.email, data.code, data.newPassword)
      if (result.success) {
        setSuccess(true)
      } else {
        setError(result.message || '重置失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : '网络错误'
      setError(msg || '重置密码失败')
    } finally {
      setSubmitting(false)
    }
  })

  if (success) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
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
          <Card className="border-border/60 shadow-xl shadow-black/[0.04] dark:shadow-black/20">
            <CardContent className="p-6 sm:p-8 text-center space-y-5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle className={cn('h-6 w-6', toneTextClass('success'))} />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-medium text-foreground">密码重置成功</h2>
                <p className="text-sm text-muted-foreground">
                  您的密码已成功重置，请使用新密码登录。
                </p>
              </div>
              <Button
                className="h-11 w-full text-sm font-medium"
                onClick={() => navigate({ to: ROUTES.public.loginAuth as never })}
              >
                前往登录
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
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
        <div className="mb-8 flex flex-col items-center">
          <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-[3px] bg-foreground">
            <span aria-hidden className="font-mono text-[18px] font-medium leading-none tracking-tight text-background">{'>_'}</span>
          </div>
          <h1
            className="font-mono text-xl font-medium tracking-tight text-foreground"
            style={{ fontFamily: 'var(--font-jetbrains-mono)' }}
          >
            {'sau@main'}
          </h1>
        </div>

        <Card className="border-border/60 shadow-xl shadow-black/[0.04] dark:shadow-black/20">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-6 space-y-1">
              <h2 className="text-lg font-medium text-foreground">重置密码</h2>
              <p className="text-sm text-muted-foreground">
                输入验证码和新密码完成重置。
              </p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-5 overflow-hidden"
              >
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                    {...form.register('email')}
                  />
                </div>
                {form.formState.errors.email && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {form.formState.errors.email.message}
                  </motion.p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-medium">
                  验证码
                </Label>
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
                    {...form.register('code')}
                  />
                </div>
                {form.formState.errors.code && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {form.formState.errors.code.message}
                  </motion.p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-sm font-medium">
                  新密码
                </Label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="至少 8 位，包含字母和数字"
                    className="h-11 pl-10 text-sm"
                    autoComplete="new-password"
                    {...form.register('newPassword')}
                  />
                </div>
                {form.formState.errors.newPassword && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {form.formState.errors.newPassword.message}
                  </motion.p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium">
                  确认密码
                </Label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="再次输入新密码"
                    className="h-11 pl-10 text-sm"
                    autoComplete="new-password"
                    {...form.register('confirmPassword')}
                  />
                </div>
                {form.formState.errors.confirmPassword && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {form.formState.errors.confirmPassword.message}
                  </motion.p>
                )}
              </div>

              <Button
                type="submit"
                className="h-11 w-full text-sm font-medium"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    重置中…
                  </>
                ) : (
                  '重置密码'
                )}
              </Button>
            </form>

            <div className="mt-5 text-center">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => navigate({ to: ROUTES.public.loginAuth as never })}
              >
                <ArrowLeft className="h-3 w-3" />
                返回登录
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground/60">
          登录即表示同意我们的服务条款和隐私政策
        </p>
      </motion.div>
    </div>
  )
}
