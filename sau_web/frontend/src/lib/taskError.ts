/**
 * Task failure humanizer — turns raw CLI / uploader error strings into
 * actionable Chinese copy + optional CTA.
 *
 * Used by TaskDrawer / TaskTableRow so operators see "Cookie 已失效 → 去重新登录"
 * instead of a stack dump or English reason code.
 */

export type TaskErrorKind =
  | 'cookie'
  | 'network'
  | 'rate_limit'
  | 'file'
  | 'platform'
  | 'timeout'
  | 'auth'
  | 'unknown'

export type TaskErrorAction = {
  /** Route path (app-relative) or null when retry-only. */
  href: string | null
  /** Button label. */
  label: string
}

export type HumanizedTaskError = {
  kind: TaskErrorKind
  /** One-line summary for table / badge. */
  title: string
  /** Longer guidance for drawer. */
  detail: string
  action: TaskErrorAction | null
  /** True when re-login is the primary fix. */
  needsRelogin: boolean
}

type Rule = {
  kind: TaskErrorKind
  test: RegExp
  title: string
  detail: string
  needsRelogin?: boolean
  action?: TaskErrorAction
}

const RULES: Rule[] = [
  {
    kind: 'cookie',
    test: /cookie[_ ]?(invalid|expired|失效|过期)|登录态|未登录|session.?expired|auth.?fail|need.?login|重新登录|qr.?login|no_file|empty_json|invalid_json/i,
    title: '登录态失效',
    detail: '账号 Cookie 已失效或文件缺失。请到账号管理重新扫码登录后再重试发布。',
    needsRelogin: true,
    action: { href: '/dashboard/accounts', label: '去重新登录' },
  },
  {
    kind: 'rate_limit',
    test: /rate.?limit|too many|429|风控|限流|频繁|verify|captcha|人机验证|risk.?control/i,
    title: '触发平台限流 / 风控',
    detail: '平台判定操作过于频繁。建议等待 30–120 分钟后重试，或降低同账号并发发布频率。',
    action: { href: null, label: '稍后重试' },
  },
  {
    kind: 'network',
    test: /network|timeout|timed.?out|ECONN|ENOTFOUND|dns|连接|网络|proxy|ssl|certificate|unreachable/i,
    title: '网络或连接异常',
    detail: '无法连接平台或中途断线。请检查本机网络 / 代理后重试。',
    action: { href: null, label: '立即重试' },
  },
  {
    kind: 'timeout',
    test: /超时|deadline|wait.?timeout|navigation.?timeout|browser.?closed/i,
    title: '操作超时',
    detail: '浏览器自动化等待页面超时。可能是平台变慢或选择器失效，可重试一次；若持续失败请查看运行日志。',
    action: { href: null, label: '立即重试' },
  },
  {
    kind: 'file',
    test: /file not found|no such file|找不到文件|视频文件|不存在|too large|文件过大|format|codec|ffmpeg/i,
    title: '媒体文件问题',
    detail: '视频/图片路径无效、格式不支持或体积超限。请重新选择文件后再发布。',
    action: { href: '/dashboard/publish', label: '重新发布' },
  },
  {
    kind: 'platform',
    test: /selector|element|not.?found|locator|上传失败|publish.?fail|平台|dom|page\.|click/i,
    title: '平台页面异常',
    detail: '自动化未能完成页面操作（平台改版或页面加载异常）。可重试；持续失败请更新 uploader 或联系维护者。',
    action: { href: null, label: '立即重试' },
  },
  {
    kind: 'auth',
    test: /permission|forbidden|403|unauthorized|401|无权限|封禁|banned|restricted/i,
    title: '账号权限受限',
    detail: '账号可能被限制发布或无对应权限。请在平台 App 内确认账号状态后再试。',
    action: { href: '/dashboard/accounts', label: '查看账号' },
  },
]

/**
 * Classify a raw task.error / log snippet into a humanized failure.
 * Empty / null → generic unknown.
 */
export function humanizeTaskError(
  raw: string | null | undefined,
  opts?: { status?: string | null },
): HumanizedTaskError {
  const text = (raw ?? '').trim()
  const status = (opts?.status ?? '').toLowerCase()

  if (!text) {
    if (status === 'cookie_invalid') {
      return {
        kind: 'cookie',
        title: '登录态失效',
        detail: '任务状态为 cookie_invalid。请重新登录对应账号后再重试。',
        needsRelogin: true,
        action: { href: '/dashboard/accounts', label: '去重新登录' },
      }
    }
    return {
      kind: 'unknown',
      title: '发布失败',
      detail: '未记录具体错误信息。请打开运行日志查看详情，或直接重试任务。',
      needsRelogin: false,
      action: { href: null, label: '立即重试' },
    }
  }

  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return {
        kind: rule.kind,
        title: rule.title,
        detail: rule.detail,
        needsRelogin: Boolean(rule.needsRelogin),
        action: rule.action ?? null,
      }
    }
  }

  // Prefer a short first line as title when no rule matches.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? text
  const short = firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
  return {
    kind: 'unknown',
    title: short,
    detail: text.length > 400 ? `${text.slice(0, 400)}…` : text,
    needsRelogin: false,
    action: { href: null, label: '立即重试' },
  }
}
