---
name: sau-backend-restart
description: 当 agent 需要重启 social-auto-upload 后端服务（Flask API on port 6001）时使用这个 skill。该 skill 适用于添加新蓝图、修改后端代码后需要重启服务、或排查后端问题时的标准化重启流程。优先使用这个 skill 进行稳定的后端重启，而不是每次手动拼接 kill + start 命令。
---

# 后端重启 Skill

该 skill 封装了 social-auto-upload 后端服务的标准重启流程，避免每次手动拼接 `pkill + find __pycache__ + python run.py` 等命令。

## 何时使用

- 添加新的 Flask 蓝图（blueprint）后需要重启服务
- 修改后端 Python 代码后需要重启生效
- 后端出现 500/502 错误需要重启恢复
- 排查后端 API 问题时的标准重启步骤
- 后端进程卡死或无响应时

不适用：前端 Vite 开发服务器重启（端口 5180）、数据库操作、CLI 命令测试。

## 前提条件

- Python 虚拟环境已激活（`.venv/`）
- `run.py` 或 `web_runner.py` 为后端入口
- 端口 6001 未被其他服务占用

## 标准重启流程

### Step 1: 停止现有进程

```bash
pkill -9 -f "run.py" 2>/dev/null
pkill -9 -f "flask" 2>/dev/null
sleep 2
```

### Step 2: 清理 Python 缓存

```bash
find /Users/a123/Notes/02-project/projecke/github/social-auto-upload -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
```

### Step 3: 启动后端服务

使用 `run.py`（推荐，包含 Flask 后端 + 热重载）：

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && python3 run.py &>/tmp/sau-backend.log &
sleep 4
```

或使用 `web_runner.py`（独立后端）：

```bash
cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && python3 web_runner.py &>/tmp/sau-backend.log &
sleep 4
```

### Step 4: 验证服务启动

```bash
curl -s http://localhost:6001/health 2>/dev/null || echo "Health check failed"
```

或验证特定 API：

```bash
curl -s http://localhost:6001/api/hotlist/toutiao 2>&1 | head -20
```

## 快速重启命令

一键执行完整重启流程（最常用）：

```bash
pkill -9 -f "run.py" 2>/dev/null; sleep 2 && find /Users/a123/Notes/02-project/projecke/github/social-auto-upload -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null && cd /Users/a123/Notes/02-project/projecke/github/social-auto-upload && python3 run.py &>/tmp/sau-backend.log & sleep 4 && curl -s http://localhost:6001/health 2>/dev/null || echo "Health check failed"
```

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 端口 6001 被占用 | `lsof -ti:6001 \| xargs kill -9 2>/dev/null` 后再重启 |
| 启动后立即退出 | 检查 `/tmp/sau-backend.log` 查看错误日志 |
| 新蓝图未注册 | Flask 不热加载蓝图，必须重启服务 |
| `__pycache__` 清理失败 | 手动删除：`find . -name "__pycache__" -exec rm -rf {} +` |

## 后端端口

- Flask API 后端: **6001**
- Vite 前端开发服务器: **5180**（非本 skill 范围）

## 日志文件

重启日志输出到：
```
/tmp/sau-backend.log
```

查看日志：
```bash
tail -50 /tmp/sau-backend.log
```

## 相关文件

- `run.py` — 主后端入口（Flask + 热重载）
- `web_runner.py` — 独立后端入口
- `web_runner/__init__.py` — 蓝图注册位置
- `web_runner/routes/` — API 路由目录
