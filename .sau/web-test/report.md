# Web Shell 全方面测试报告

生成时间: 2026-07-22T23:13:15.805Z

## 总览

- 页面: **26/29** 通过
- 交互/功能: **26** 通过 / **3** 失败
- 有 API 4xx/5xx 的页面: 4
- 有控制台/页面错误的页面: 8

## 页面结果

| 状态 | 路径 | 最终 URL | 耗时 | H1 | API失败 | JS错误 |
|---|---|---|---:|---|---:|---:|
| PASS | `/` | `/` | 6071ms | One video. One command. Every platform. | 0 | 0 |
| PASS | `/login` | `/dashboard/publish` | 5719ms | 发布中心 | 0 | 0 |
| PASS | `/login/auth` | `/dashboard/publish` | 3580ms | 发布中心 | 0 | 0 |
| PASS | `/login/forgot-password` | `/dashboard/publish` | 3441ms | 发布中心 | 0 | 0 |
| PASS | `/login/reset-password` | `/dashboard/publish` | 3461ms | 发布中心 | 0 | 0 |
| PASS | `/pricing` | `/pricing` | 1859ms | 按你的运营规模 选择套餐 | 0 | 0 |
| PASS | `/about` | `/about` | 2139ms |  | 0 | 0 |
| PASS | `/hotlist` | `/hotlist` | 2809ms | 今日热榜 | 24 | 12 |
| FAIL | `/catalog` | `/catalog` | 1974ms |  | 0 | 2 |
| PASS | `/dashboard` | `/dashboard` | 2181ms | 账号管理 | 0 | 0 |
| PASS | `/dashboard/publish` | `/dashboard/publish` | 2892ms | 发布中心 | 0 | 0 |
| PASS | `/dashboard/tasks` | `/dashboard/tasks` | 2283ms | 任务列表 | 0 | 0 |
| PASS | `/dashboard/calendar` | `/dashboard/calendar` | 2870ms | 内容日历 | 0 | 0 |
| PASS | `/dashboard/analytics` | `/dashboard/analytics` | 2449ms | 数据分析 | 0 | 0 |
| PASS | `/dashboard/logs` | `/dashboard/logs` | 2544ms | 运行日志 | 0 | 0 |
| PASS | `/dashboard/inbox` | `/dashboard/inbox` | 2431ms | 下载中心 | 0 | 0 |
| FAIL | `/dashboard/studio` | `/dashboard/studio` | 2245ms |  | 0 | 2 |
| FAIL | `/dashboard/studio/1` | `/dashboard/studio/1` | 2115ms |  | 0 | 2 |
| PASS | `/dashboard/account` | `/dashboard/account` | 2291ms | 账户 | 0 | 0 |
| PASS | `/dashboard/settings` | `/dashboard/settings` | 2121ms | 设置 | 0 | 0 |
| PASS | `/dashboard/personalization` | `/dashboard/personalization` | 2220ms | 个性化 | 0 | 0 |
| PASS | `/dashboard/crawl` | `/dashboard/crawl` | 2529ms | 数据采集 / 评论监控 | 0 | 2 |
| PASS | `/dashboard/admin` | `/dashboard/admin` | 2250ms | 系统概览 | 7 | 7 |
| PASS | `/dashboard/admin/users` | `/dashboard/admin/users` | 2254ms | 用户管理 | 2 | 2 |
| PASS | `/dashboard/admin/audit` | `/dashboard/admin/audit` | 2249ms | 操作日志 | 4 | 4 |
| PASS | `/publish` | `/publish` | 1954ms |  | 0 | 0 |
| PASS | `/tasks` | `/tasks` | 1833ms |  | 0 | 0 |
| PASS | `/logs` | `/logs` | 1941ms |  | 0 | 0 |
| PASS | `/analytics` | `/analytics` | 1855ms |  | 0 | 0 |

## 交互结果

- ✅ **dashboard shows account group**
- ✅ **dashboard create group dialog**
- ✅ **publish page form surface**
- ✅ **publish switch note mode**
- ✅ **tasks page shows data**
- ✅ **tasks filter failed chip**
- ✅ **logs page shows entries**
- ❌ **studio lists projects**
- ❌ **studio create + open detail**
- ✅ **crawl page content**
- ✅ **inbox download surface**
- ✅ **analytics metrics**
- ✅ **calendar surface**
- ✅ **settings page renders**
- ✅ **personalization page renders**
- ✅ **account profile page**
- ✅ **admin overview**
- ✅ **nav click to publish**
- ✅ **command palette Meta+K**
- ✅ **pricing page tiers**
- ✅ **hotlist page content**
- ✅ **about page content**
- ✅ **login page fields**
- ✅ **API account-groups + templates + analytics**
- ✅ **API crawl data + inbox list**
- ✅ **API calendar range**
- ❌ **legacy /publish redirects**
- ✅ **publish fill title draft**
- ✅ **tasks has retry/delete actions**

## 问题详情

### hotlist (`/hotlist`)

- finalUrl: `http://localhost:5174/hotlist`
- failedApi:
```json
[
  {
    "url": "/api/hotlist/douyin",
    "status": 404
  },
  {
    "url": "/api/hotlist/bilibili",
    "status": 404
  },
  {
    "url": "/api/hotlist/kuaishou",
    "status": 404
  },
  {
    "url": "/api/hotlist/weibo",
    "status": 404
  },
  {
    "url": "/api/hotlist/zhihu",
    "status": 404
  },
  {
    "url": "/api/hotlist/baidu",
    "status": 404
  },
  {
    "url": "/api/hotlist/toutiao",
    "status": 404
  },
  {
    "url": "/api/hotlist/36kr",
    "status": 404
  },
  {
    "url": "/api/hotlist/sspai",
    "status": 404
  },
  {
    "url": "/api/hotlist/ithome",
    "status": 404
  },
  {
    "url": "/api/hotlist/douban-movie",
    "status": 404
  },
  {
    "url": "/api/hotlist/qq-news",
    "status": 404
  },
  {
    "url": "/api/hotlist/douyin",
    "status": 404
  },
  {
    "url": "/api/hotlist/bilibili",
    "status": 404
  },
  {
    "url": "/api/hotlist/kuaishou",
    "status": 404
  },
  {
    "url": "/api/hotlist/weibo",
    "status": 404
  },
  {
    "url": "/api/hotlist/zhihu",
    "status": 404
  },
  {
    "url": "/api/hotlist/baidu",
    "status": 404
  },
  {
    "url": "/api/hotlist/36kr",
    "status": 404
  },
  {
    "url": "/api/hotlist/toutiao",
    "status": 404
  },
  {
    "url": "/api/hotlist/ithome",
    "status": 404
  },
  {
    "url": "/api/hotlist/douban-movie",
    "status": 404
  },
  {
    "url": "/api/hotlist/sspai",
    "status": 404
  },
  {
    "url": "/api/hotlist/qq-news",
    "status": 404
  }
]
```
- console:
```
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
```
- snippet: >_ social-auto-upload Home Pricing Hot List About 本 今日热榜 汇聚全网热点 全部 抖音 快手 哔哩哔哩 微博 知乎 百度 今日头条 豆瓣 36氪 少数派 IT之家 腾讯新闻 抖音 暂无数据 快手 暂无数据 哔哩哔哩 暂无数据 微博 暂无数据 知乎 暂无数据 百度 暂无数据 今日头条 暂无数据 豆瓣 暂无数据 36氪 暂无数据 少数派 暂无数据 IT之家 暂无数据 腾讯新闻 暂无数据 >

### catalog (`/catalog`)

- finalUrl: `http://localhost:5174/catalog`
- console:
```
%o

%s

%s
 InvalidCharacterError: Failed to execute 'createElement' on 'Document': The tag name provided ('# Design components
') is not a valid name.
    at completeWork (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:6361:137)
    at runWithFiberInDEV (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:851:66)
    at completeUnitOfWork (ht
ErrorBoundary caught: InvalidCharacterError: Failed to execute 'createElement' on 'Document': The tag name provided ('# Design components
') is not a valid name.
    at completeWork (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:6361:137)
    at runWithFiberInDEV (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:851:66)
    at completeUnit
```
- snippet: 页面出错了 应用遇到了一个错误，刷新页面通常可以解决。 Failed to execute 'createElement' on 'Document': The tag name provided ('# Design components ') is not a valid name. 刷新页面

### studio (`/dashboard/studio`)

- finalUrl: `http://localhost:5174/dashboard/studio`
- console:
```
%o

%s

%s
 TypeError: Cannot read properties of undefined (reading 'labelKey')
    at ProjectCard (http://localhost:5174/src/components/Studio/ProjectCard.tsx?t=1784745972804:69:53)
    at Object.react_stack_bottom_frame (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:12866:12)
    at renderWithHooks (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?
ErrorBoundary caught: TypeError: Cannot read properties of undefined (reading 'labelKey')
    at ProjectCard (http://localhost:5174/src/components/Studio/ProjectCard.tsx?t=1784745972804:69:53)
    at Object.react_stack_bottom_frame (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:12866:12)
    at renderWithHooks (http://localhost:5174/node_modules/.vite/deps/react-dom_
```
- snippet: 页面出错了 应用遇到了一个错误，刷新页面通常可以解决。 Cannot read properties of undefined (reading 'labelKey') 刷新页面

### studio-detail (`/dashboard/studio/1`)

- finalUrl: `http://localhost:5174/dashboard/studio/1`
- console:
```
%o

%s

%s
 TypeError: Cannot read properties of undefined (reading 'labelKey')
    at ProjectCard (http://localhost:5174/src/components/Studio/ProjectCard.tsx?t=1784745972804:69:53)
    at Object.react_stack_bottom_frame (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:12866:12)
    at renderWithHooks (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?
ErrorBoundary caught: TypeError: Cannot read properties of undefined (reading 'labelKey')
    at ProjectCard (http://localhost:5174/src/components/Studio/ProjectCard.tsx?t=1784745972804:69:53)
    at Object.react_stack_bottom_frame (http://localhost:5174/node_modules/.vite/deps/react-dom_client.js?v=45156635:12866:12)
    at renderWithHooks (http://localhost:5174/node_modules/.vite/deps/react-dom_
```
- snippet: 页面出错了 应用遇到了一个错误，刷新页面通常可以解决。 Cannot read properties of undefined (reading 'labelKey') 刷新页面

### crawl (`/dashboard/crawl`)

- finalUrl: `http://localhost:5174/dashboard/crawl`
- console:
```
In HTML, %s cannot be a descendant of <%s>.
This will cause a hydration error.%s <div> p 

  ...
    <CrawlPage>
      <CrawlDashboardPage>
        <PageWrapper>
          <div className="p-6 max-w-..." data-testid={undefined}>
            <div className="space-y-6">
              <motion.div>
              <HealthStatsStrip platform="xhs">
                <div className="grid grid-...">
         
<%s> cannot contain a nested %s.
See this log for the ancestor stack trace. p <div>
```
- snippet: SAU Shell Social Auto Upload 导航 账号管理 发布中心 任务列表 数据分析 运行日志 下载中心 内容日历 剧本工坊 数据采集 S SAU Admin v1.0.0 重新引导 搜索 ⌘K 数据采集 / 评论监控 7 个平台的关键词搜索 · 帖子详情 · 评论树 · AI 情感分析 + 自动回复建议 小红书 抖音 快手 B站 微博 贴吧 知乎 关键词搜索 帖子详情 二级评论 AI 情感 回复建议 0 内容总数 0

### admin (`/dashboard/admin`)

- finalUrl: `http://localhost:5174/dashboard/admin`
- failedApi:
```json
[
  {
    "url": "/api/admin/system?_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/overview?_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/trends?metric=active_today&days=14&_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/trends?metric=total_tasks&days=14&_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/trends?metric=task_success_rate&days=14&_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/trends?metric=total_users&days=14&_t=1784761908124",
    "status": 404
  },
  {
    "url": "/api/admin/overview?_t=1784761909142",
    "status": 404
  }
]
```
- console:
```
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
```
- snippet: SAU Shell Social Auto Upload 导航 账号管理 发布中心 任务列表 数据分析 运行日志 下载中心 内容日历 剧本工坊 数据采集 S SAU Admin v1.0.0 重新引导 搜索 ⌘K 概览 用户管理 审计日志 系统概览 项目使用统计与最近活动 尚未更新 7d 14d 30d 下载趋势 刷新 0 总用户数 全部 0 今日活跃 活跃用户 0 总任务数 历史累计 0% 任务成功率 近 30 天 最近操作 最近 1

### admin-users (`/dashboard/admin/users`)

- finalUrl: `http://localhost:5174/dashboard/admin/users`
- failedApi:
```json
[
  {
    "url": "/api/admin/users?_t=1784761910492",
    "status": 404
  },
  {
    "url": "/api/admin/users?_t=1784761911501",
    "status": 404
  }
]
```
- console:
```
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
```
- snippet: SAU Shell Social Auto Upload 导航 账号管理 发布中心 任务列表 数据分析 运行日志 下载中心 内容日历 剧本工坊 数据采集 S SAU Admin v1.0.0 重新引导 搜索 ⌘K 概览 用户管理 审计日志 用户管理 查看和管理所有注册用户 共 0 位用户 EMPTY DIRECTORY 还没有注册用户 等待第一位用户通过邮箱验证码或社交登录注册

### admin-audit (`/dashboard/admin/audit`)

- finalUrl: `http://localhost:5174/dashboard/admin/audit`
- failedApi:
```json
[
  {
    "url": "/api/admin/audit/acknowledge",
    "status": 404
  },
  {
    "url": "/api/admin/audit?page=1&per_page=50&_t=1784761912749",
    "status": 404
  },
  {
    "url": "/api/admin/audit/acknowledge",
    "status": 404
  },
  {
    "url": "/api/admin/audit?page=1&per_page=50&_t=1784761913790",
    "status": 404
  }
]
```
- console:
```
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
Failed to load resource: the server responded with a status of 404 (NOT FOUND)
```
- snippet: SAU Shell Social Auto Upload 导航 账号管理 发布中心 任务列表 数据分析 运行日志 下载中心 内容日历 剧本工坊 数据采集 S SAU Admin v1.0.0 重新引导 搜索 ⌘K 概览 用户管理 审计日志 操作日志 管理员操作审计记录 全部 今天 本周 本月 自定义 EMPTY LOG 暂无操作记录 管理员操作（如角色变更）会记录在这里

## 失败/软失败交互详情

### studio lists projects

```json
{
  "ok": false,
  "hasProject": false,
  "snippet": "页面出错了\n\n应用遇到了一个错误，刷新页面通常可以解决。\n\nCannot read properties of undefined (reading 'labelKey')\n刷新页面"
}
```

### studio create + open detail

```json
{
  "ok": false,
  "id": 5,
  "status": 200,
  "snippet": "页面出错了\n\n应用遇到了一个错误，刷新页面通常可以解决。\n\nCannot read properties of undefined (reading 'labelKey')\n刷新页面"
}
```

### legacy /publish redirects

```json
{
  "ok": false,
  "url": "http://localhost:5174/publish"
}
```

