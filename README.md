<div align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/icon.svg" width="88" alt="OpenCode 用量面板 logo">
</div>

<h1 align="center">OpenCode 用量面板</h1>

<p align="center">
  <b>在 DeepSeek Harness 侧栏，随时看清 OpenCode 的额度、花费和趋势。</b>
</p>

<p align="center">
  <img alt="DeepSeek Harness 0.2.x" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-2f6fed">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-2ea043">
  <img alt="界面：中文 / English" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87%20%7C%20English-8b5cf6">
  <img alt="数据：OpenCode Go / Console" src="https://img.shields.io/badge/%E6%95%B0%E6%8D%AE-OpenCode%20Go%20%2F%20Console-1f6feb">
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#界面">界面</a> ·
  <a href="#账户形态">账户形态</a> ·
  <a href="https://github.com/zhxmt-xm/dsh-opencode-usage-dashboard/blob/main/docs/README.md">开发与原理</a>
</p>

> [!NOTE]
> 这是 DeepSeek Harness 的第三方插件，数据来自 OpenCode 官方。

<div align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/screenshot-card.png" alt="侧栏用量卡片：用量、额度、预测、趋势、模型五个分块" width="320">
  <br>
  <sub>侧栏卡片（浅色主题，示意数据）：用量 · 额度 · 预测 · 趋势 · 模型</sub>
</div>

## 为什么用它

OpenCode 的额度、花费和用量分散在几个接口里：Go 订阅的滚动 / 周 / 月窗口，Console 的花费与 token。这个插件把它们收进一张侧栏卡片，不用打开网页控制台，也不用自己算。

- **Go 和按量账户都能用**：有 Go 订阅时显示额度窗口；只有 Console 用量时保留花费、趋势和模型。
- **知道今天花了多少**：今日花费、请求数、tokens，以及本周 / 本月汇总。
- **看见趋势**：7 天 / 24 小时，花费 / tokens / 请求数随时切换。
- **提前知道会不会用完**：有月度额度时，按当前计费周期的花费速度外推，标出 50% / 100% 的预计日期。
- **知道钱花在哪个模型**：按花费排序的模型条形图。
- **多账户不打架**：同一组织的 Key 合并成一张卡，不同组织分开；可切换账户，花费可按服务账号筛选。
- **高度可配置**：分块显示/隐藏与排序、色条、四档阈值、趋势指标、刷新间隔都能改。
- **不打扰**：跟随 DSH 主题、中英双语、无外部 CDN，偏好只存在本机。

## 界面

下面按侧栏卡片的五个分块、设置页的三个面板分别说明。截图使用固定样例数据（`acme` / `org_acme` 等账户名与组织 id 均为虚构），实际数字随账户变化。

### 侧栏卡片

卡片放在侧栏设置按钮上方；侧栏收起时退化为一个百分比/金额小方块，展开后按偏好顺序显示五个分块。卡片顶部是账户入口：点账户名可切换组织和服务账号，右侧是刷新与设置按钮。

#### 用量

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/card-today.png" alt="用量分块：本月剩余油表，以及今日、本周、本月的花费与请求数" width="300">
</p>

- 今日花费、请求数、tokens；
- Tokens 列默认显示紧凑值，悬停或键盘聚焦可看精确到个位的数字；
- 有月度额度时，顶部油表显示本月剩余百分比；
- 下方并排汇总今日、本周、本月，不用来回切页面。

#### 额度

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/card-quota.png" alt="额度分块：滚动、每周、每月三个窗口与重置倒计时" width="300">
</p>

- 滚动 5 小时、本周、本月三个窗口；
- 进度条按四档分级变色，右侧显示已用百分比；
- 每行带重置倒计时；没有 Go 订阅时整块隐藏。

#### 预测

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/card-forecast.png" alt="预测分块：实测花费曲线、预测虚线与 50%/100% 预计日期" width="300">
</p>

- 按当前计费周期的花费速度做线性外推；
- 绿色为实测、橙色为预测，标出 50% / 100% 的预计日期；
- 没有月度额度或有效数据不足两个点时整块隐藏。

#### 趋势

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/card-trend.png" alt="趋势分块：7 天或 24 小时的花费、tokens、请求数柱状图" width="300">
</p>

- 7 天 / 24 小时切换；
- 花费 / tokens / 请求数切换；
- 没有数据时保留分块，显示空态文案。

#### 模型

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/card-models.png" alt="模型分块：按花费排序的模型条形图" width="300">
</p>

- 按花费排序，条形长度按最高花费归一化；
- 最多显示四行；
- 没有按模型计费记录时整块隐藏。

### 设置页

设置 → OpenCode 套餐。Key 仍在 DSH 的 provider 设置里管理，这一页只读。

#### 账户

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/settings-account.png" alt="设置页账户面板：按组织分组的账户、服务账号、刷新间隔" width="640">
</p>

- 账户按组织分组，同一组织的 Key 合成一张卡；
- 当前账户打绿色「当前」，其余可「切换」；组织下的服务账号可以单独筛选花费；
- 「刷新数据」立即重读，刷新间隔可选 30 秒 / 1 分钟 / 5 分钟 / 15 分钟；
- Key 只读，改 Key 去 DSH 设置 → Providers（`llm-pi-ai`）。

#### 显示

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/settings-display.png" alt="设置页显示面板：卡片色条开关、色条颜色与四档进度条" width="640">
</p>

- 卡片样式：开关控制是否显示左侧色条，旁边选色条颜色；
- 进度条分级：四档的名称、区间、颜色都可以改，区间首尾相接；
- 「恢复默认」回到 0–50 绿、50–75 黄、75–90 橙、90–100 红。

#### 卡片展示

<p align="center">
  <img src="https://raw.githubusercontent.com/zhxmt-xm/dsh-opencode-usage-dashboard/main/docs/shots/settings-preview.png" alt="设置页卡片展示面板：五个分块的预览、勾选显示与拖拽排序" width="640">
</p>

- 直接预览五个分块，勾选框控制侧栏显示 / 隐藏；
- 拖拽分块标题调整顺序；
- 趋势的 7 天 / 24 小时、花费 / tokens / 请求数切换也在这里；
- 右上角 `?` 有操作提示。

> 这里没有单独的「趋势图」设置面板：趋势的显示范围与指标就在卡片展示的预览里切换。

## 账户形态

卡片的五个分块由**接口数据**决定，不是配置开关，也不看 provider 名：

| 形态 | 你会看到 |
| --- | --- |
| 只有 Go 订阅 | 五个分块齐全 |
| 只有 Console 按量 | 额度与预测隐藏，保留用量、趋势、模型 |
| Go + Console | 合并成一张卡，与「只有 Go」一致 |

插件用 `GET /inference/go/v1/usage` 的 200/404 判断有没有 Go 订阅，provider id 只决定优先用哪把 Key。完整规则见 [开发与原理 → 账户形态](https://github.com/zhxmt-xm/dsh-opencode-usage-dashboard/blob/main/docs/README.md#账户形态)。

## 安装

### 环境

- DeepSeek Harness Desktop 0.2.x（开发环境 `0.2.1-rc.5`；Web profile 同理）；
- 一个 OpenCode Go 订阅，或仅有 Console 用量的 OpenCode 账户；
- 能访问 `opencode.ai`。

### 从 GitHub 安装（推荐）

```sh
dsh plugin --profile desktop add github:zhxmt-xm/dsh-opencode-usage-dashboard
```

Web 版 profile：

```sh
dsh plugin --profile web add github:zhxmt-xm/dsh-opencode-usage-dashboard
```

### 从 npm 安装

```sh
dsh plugin --profile desktop add dsh-opencode-usage-dashboard
```

### 本地开发安装

在仓库根目录运行：

```powershell
npm start
```

这是本地开发用的安装源切换器，按提示选择：

- **1) 本地 link**：把 desktop profile 指回当前仓库，改完代码后重载插件（必要时重启 DSH）；
- **2) GitHub**：安装 GitHub 版，用来验证用户实际拿到的发布包。

脚本固定执行“卸载 → 清理 `node_modules` 里的旧 junction/临时目录 → 安装所选来源”。DSH 卸载 `link:` 安装时不会删除 junction，直接切换会 `EPERM`，所以从 link 切到 GitHub 不要只靠 DSH 的卸载按钮。

运行前先完全退出 DSH（Windows 下脚本会检查），并确保 `dsh` 命令在 PATH 上。默认操作 `desktop` profile；需要指定其他 profile 或代理时：

```powershell
$env:DSH_PROFILE = 'web'
$env:DSH_PROXY = 'http://127.0.0.1:7890'
npm start
```

GitHub 选项需要能访问 github.com；`DSH_PROXY` 不设置时默认使用 `http://127.0.0.1:7890`。

不想用脚本时，也可以手动安装本地 link：

```powershell
dsh plugin --profile desktop add "link:C:\path\to\dsh-opencode-usage-dashboard"
```

`link:` 直接引用本地目录，改代码后重载插件（必要时重启 DSH），不需要重新安装。

### 配置 Key

插件读取 DSH 里已有的 `opencode` / `opencode-go` provider 凭据：

1. 打开 DSH 设置 → Providers（`llm-pi-ai`）；
2. 配置 `opencode-go` 和/或 `opencode` 的 API Key；
3. 回到「设置 → OpenCode 套餐」，点「刷新数据」。

Key 也可以走环境变量回退：`OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`。插件设置页只读，不会把 Key 下发到浏览器。

### 更新 / 卸载

```sh
# GitHub 安装的更新：重新执行 add；没拉到新提交就先 remove 再 add
dsh plugin --profile desktop add github:zhxmt-xm/dsh-opencode-usage-dashboard

# npm 安装的更新（Market 里也可以直接点更新）
dsh plugin --profile desktop add dsh-opencode-usage-dashboard

# 卸载
dsh plugin --profile desktop remove dsh-opencode-usage-dashboard
```

## 数据与隐私

- Key 只在 DSH Host 进程内使用，不下发到浏览器、不写日志；
- 额度数据不落盘；界面偏好存在浏览器 `localStorage`；
- 所有 Host 路由只接受本机回环请求，并校验 `Origin` / `sec-fetch-site`；
- 上游请求 12 秒超时、拒绝重定向、响应体上限 256 KB。

架构、接口、已知限制、调试与发布检查见 [docs/README.md](https://github.com/zhxmt-xm/dsh-opencode-usage-dashboard/blob/main/docs/README.md)。

## 许可

- 插件代码：MIT，见 [LICENSE](https://github.com/zhxmt-xm/dsh-opencode-usage-dashboard/blob/main/LICENSE)；
- 内嵌 Noto Sans SC 字体：SIL OFL 1.1，见 [THIRD_PARTY_NOTICES.md](https://github.com/zhxmt-xm/dsh-opencode-usage-dashboard/blob/main/THIRD_PARTY_NOTICES.md)。

---

<div align="center">
  <sub>Made for DeepSeek Harness · 数据来自 OpenCode</sub>
</div>
