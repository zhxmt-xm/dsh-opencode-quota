# 参考图

`scenarios.png` — 三种账户形态 × 每个分块的空态（浅色主题，1344 × 2973）。

- **A 段**：每种形态都保留全部五个分块。产品里会整块隐藏的分块画成虚线禁用块，位置不动，所以三列能按同一顺序横向对比。
- **B 段**：每个分块的不同空态各占一格，下面是该状态的说明。

图不是手绘的：`render-scenarios.cjs` 用一套极小的 React 替身直接在 Node 里跑 `client.js` 的组件，把元素树序列化成静态 HTML，再交给浏览器排版。

## 重新生成

```bash
node docs/render-scenarios.cjs        # → docs/scenarios.html
```

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --hide-scrollbars --force-device-scale-factor=1.4 --window-size=960,2700 `
  --screenshot=docs\scenarios.png "file:///<仓库路径>/docs/scenarios.html"
```

截图比页面高，底部会有一段背景色，按背景色 `#eceae6` 裁掉即可（内容下沿留 20px 左右）。

## 数据是写死的

脚本把「现在」固定成 `2026-10-29 15:40 (UTC+8)`，只影响重置倒计时与预测斜率；花费、tokens、模型、趋势曲线都是常量，所以同一版本重复渲染出来的图基本一致。

判断依据来自真实代码路径：`windows` 为 `null` 就是没有 Go 额度，预测块缺 `monthly` 或周期点数不足就返回 `null`——这些分支与线上完全一致，只是数据换成了样例。
