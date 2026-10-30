# OpenCode 套餐面板（DSH 插件）

在 DeepSeek Harness 的侧栏显示 OpenCode Go 订阅额度，并在设置里提供账户、外观与数据视图。

## 安装

本地目录安装（GUI）：

1. 左侧栏 → **插件** → **添加插件**；
2. 粘贴包目录绝对路径：`C:\code\dsh-opencode-quota`；
3. 安装 → **立即启用**。

命令行等价方式：

```bash
dsh plugin --profile desktop add "link:C:\code\dsh-opencode-quota"
```

安装后**完全退出应用再启动**（Host 半边需要重新加载）。

## 显示内容

侧栏卡片（设置按钮上方）：

- 三个额度窗口：滚动 5 小时 / 本周 / 本月，含重置倒计时与进度条；
- 今日花费、请求数、tokens；
- 最近 7 天花费走势；
- 收起侧栏时退化为一个百分比/金额小方块。

设置 → **OpenCode 套餐**：

- 账户：列出 DSH 里的账户和各自 provider 凭据（只读，Key 在 DSH 的 provider 设置里改）；当前账户打绿色「当前」tag，其余可「切换」——切换即自动刷新，右上「刷新数据」也能立刻重读；
- 卡片展示：预览五个分块，勾选控制是否显示在侧栏，拖拽调整顺序，`?` 里有说明；
- 趋势图：7 天 / 24 小时切换，花费 / tokens / 请求数切换；
- 本周与上周对比、缓存命中率；
- 模型花费条形图；
- 额度走势与"按当前速度是否会在重置前用完"的预测；
- 外观：进度条分级（四档，名称/区间/颜色/是否跟随主题）、刷新间隔。

## 账户形态

卡片的五个分块由**接口数据**决定，不是配置开关，也不看 provider 名：

| 形态 | 触发条件 | 渲染结果 |
| --- | --- | --- |
| 只有 Go 订阅 | 任一 Key 调 `GET /inference/go/v1/usage` 返回窗口 | 五块齐全 |
| 没有 Go 订阅（Console 用量） | 该接口 404（`NOT_SUBSCRIBED`） | 额度、预测整块隐藏；用量没有油表，只留表格 |
| Go + Console 用量 | 同一个组织既有 Go 订阅、又有 Console 花费 | 合并成一张卡，与「只有 Go」一致 |

DSH 里的 `opencode-go` / `opencode` 只是两个连接预设，不能拿来判断计费方式：同一个组织的任意服务账号 Key 都能读 Go 额度，额度本身也是组织级共享的。插件用 `/inference/go/v1/usage` 的 200/404 做订阅探测，provider id 只决定优先用哪把 Key。

五个分块的空态（额度缺百分比、用量为空、预测数据不足、趋势无数据、模型无记录）与对应截图见 [docs/scenarios.png](docs/scenarios.png)。

## 数据来源

| 数据 | 接口 | 作用域 |
| --- | --- | --- |
| 三个额度窗口 | `GET https://opencode.ai/inference/go/v1/usage` | **组织级**，不支持按服务账号过滤 |
| 是否 Go 订阅 | 同一个 `GET /inference/go/v1/usage`：200 = 有，404 = 无 | 组织级；任一服务账号 Key 都能探测 |
| 今日花费与 token | `GET https://opencode.ai/console/api/usage/summary?since=…` | 默认组织，可加 `serviceAccountId=` |
| 按天/按小时花费 | `GET https://opencode.ai/console/api/usage/cost-by-day?range=…` | 同上 |
| 按模型花费 | `GET https://opencode.ai/console/api/usage/models` | 同上 |
| 账户身份 | `GET /console/api/service-accounts` 的 `keys[].tokenHint`（Key 前缀）匹配出服务账号；读不到时退回 `/usage/users`、再退回 `/config` 的 org id | 组织级列表 |

`/usage/users` 不区分 Key（同组织的两个 Key 都返回同一个用户），所以身份优先用 `service-accounts` 的 `tokenHint` 前缀匹配。花费与模型按服务账号过滤，额度是组织共享的一份。

Key 来自 DSH 凭据库：优先用 `llm-pi-ai` 里该 provider 的 `apiKeyEnv`，缺省回落到 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`。

## 安全

- 所有 Host 路由只接受本机回环请求，并校验 `Origin` / `sec-fetch-site`；
- Key 只在 Host 进程内使用，不下发到浏览器、不写日志；
- 额度数据不落盘；界面偏好写在浏览器 `localStorage`，客户端错误日志写到 `$DSH_HOME/opencode-quota/client.log`。

## 已知限制

- **读不到套餐类型**（Go / Go Plus）：控制台的 `GET /console/api/orgs/current` 里其实有 `hasGoSubscription` / `goSubscription`，但服务账号 Key 调它返回 403，只接受控制台会话；`/api/internal/orgs/:orgId/go/status` 也不对外。插件因此只判断「有没有 Go 订阅」，分不清 Go / Go Plus。
- **预测只用当前计费周期**：没有额度历史接口，预测来自当前周期的每日花费；周期数据不足两个点时隐藏预测块。
- **没有按模型按天的数据**：`cost-by-day` 不接受模型维度，模型只有区间总量。
- 自定义 provider 若指向非 `opencode.ai` 的中转站，不会被识别。

## 许可

内嵌 Noto Sans SC 子集/完整字体，SIL OFL 1.1，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
