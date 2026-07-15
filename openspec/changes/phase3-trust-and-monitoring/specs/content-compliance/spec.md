# content-compliance

> **Moved from `product-roadmap-2026q3` on 2026-07-12 (umbrella decomposition).** 内容未变更，仅目录搬迁。

内容合规预检能力。

## ADDED Requirements

### Requirement: 敏感词检测

The system SHALL 使用 pyahocorasick 实现高效的敏感词匹配。

#### Scenario: 文本敏感词检测
- GIVEN 用户输入文本内容
- When 触发合规检查
- Then 系统使用 Aho-Corasick 自动机匹配敏感词
- And 返回命中列表（敏感词 + 位置 + 命中规则）

#### Scenario: 批量文本检测
- GIVEN 多条待发布内容
- When 触发批量合规检查
- Then 逐条检测并返回每条的检测结果
- And 单条失败不阻断整批

#### Scenario: 检测性能
- GIVEN 1000+ 敏感词库
- When 检测 1000 字文本
- Then 检测时间 < 100ms
- And 内存占用 < 50MB

### Requirement: 平台特定规则

The system SHALL 支持按平台配置不同的合规规则。

#### Scenario: 抖音规则检查
- GIVEN 待发布到抖音的内容
- When 执行合规检查
- Then 检查抖音特定规则（如禁止微信号、禁止外部链接）
- And 返回平台特定的违规提示

#### Scenario: 小红书规则检查
- GIVEN 待发布到小红书的内容
- When 执行合规检查
- Then 检查小红书特定规则（如禁止竞品名称、禁止夸大宣传）
- And 返回平台特定的违规提示

#### Scenario: 规则可配置
- GIVEN 管理员需要调整规则
- When 访问合规规则管理页面
- Then 可添加/编辑/删除规则
- And 规则变更实时生效

### Requirement: 自定义敏感词库

The system SHALL 用户应可自定义敏感词库。

#### Scenario: 上传自定义词库
- GIVEN 用户准备敏感词列表文件
- When 上传词库文件
- Then 系统导入自定义敏感词
- And 与内置词库合并使用

#### Scenario: 词库管理
- Given 用户访问词库管理页面
- When 查看词库
- Then 展示内置词库 + 自定义词库
- And 支持启用/禁用特定词库

### Requirement: 合规检查集成

The system SHALL 合规检查应集成到发布流程中。

#### Scenario: 发布前自动检查
- GIVEN 用户点击「发布」按钮
- When 内容未通过合规检查
- Then 阻止发布并展示违规内容
- And 提供修改建议

#### Scenario: 合规检查通过
- GIVEN 内容通过合规检查
- When 用户点击「发布」按钮
- Then 正常执行发布流程
- And 记录合规检查通过日志

#### Scenario: 跳过合规检查
- GIVEN 用户选择「跳过检查」
- When 点击发布
- Then 直接执行发布
- And 记录跳过检查日志
