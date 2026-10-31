# 生成 README 用的单块 / 单面板截图。
#
#   powershell -ExecutionPolicy Bypass -File docs/capture-shots.ps1
#
# 先跑 render-scenarios.cjs 写出 docs/shots/*.html，再用 Edge 无头截图，
# 最后按背景色裁掉多余空白并补一圈内边距。只支持 Windows（依赖 Edge 与 System.Drawing）。

param(
  [string]$Edge = '',
  [int]$Scale = 2
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$docs = $PSScriptRoot
$shots = Join-Path $docs 'shots'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-opencode-usage-dashboard-shots'

if (-not $Edge) {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  $Edge = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Edge) { throw '找不到 Microsoft Edge，请用 -Edge 指定 msedge.exe 路径。' }

Push-Location $root
try {
  node docs/render-scenarios.cjs
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $shots | Out-Null

if (-not ('ShotTrim' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ShotTrim {
    private static bool IsBg(byte[] bytes, int stride, int x, int y, byte r, byte g, byte b, int tol) {
        int i = y * stride + x * 4;
        return Math.Abs(bytes[i + 2] - r) <= tol && Math.Abs(bytes[i + 1] - g) <= tol && Math.Abs(bytes[i] - b) <= tol;
    }

    public static void TrimPad(string input, string output, int pad, int tol) {
        using (var src = new Bitmap(input))
        using (var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0);
            int w = bmp.Width, h = bmp.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] bytes = new byte[stride * h];
            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            bmp.UnlockBits(data);
            byte r = bytes[2], gg = bytes[1], b = bytes[0];
            int minX = 0, minY = 0, maxX = w - 1, maxY = h - 1;
            bool found;
            for (minY = 0; minY < h; minY++) {
                found = false;
                for (int x = 0; x < w; x++) if (!IsBg(bytes, stride, x, minY, r, gg, b, tol)) { found = true; break; }
                if (found) break;
            }
            for (maxY = h - 1; maxY >= minY; maxY--) {
                found = false;
                for (int x = 0; x < w; x++) if (!IsBg(bytes, stride, x, maxY, r, gg, b, tol)) { found = true; break; }
                if (found) break;
            }
            for (minX = 0; minX < w; minX++) {
                found = false;
                for (int y = minY; y <= maxY; y++) if (!IsBg(bytes, stride, minX, y, r, gg, b, tol)) { found = true; break; }
                if (found) break;
            }
            for (maxX = w - 1; maxX >= minX; maxX--) {
                found = false;
                for (int y = minY; y <= maxY; y++) if (!IsBg(bytes, stride, maxX, y, r, gg, b, tol)) { found = true; break; }
                if (found) break;
            }
            if (maxX < minX || maxY < minY) throw new Exception("no content in " + input);
            int cw = maxX - minX + 1, ch = maxY - minY + 1;
            using (var dst = new Bitmap(cw + pad * 2, ch + pad * 2, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(dst)) {
                g.Clear(Color.FromArgb(255, r, gg, b));
                g.DrawImage(bmp, new Rectangle(pad, pad, cw, ch), new Rectangle(minX, minY, cw, ch), GraphicsUnit.Pixel);
                dst.Save(output, ImageFormat.Png);
            }
            Console.WriteLine("{0} -> {1} ({2}x{3})", input, output, cw + pad * 2, ch + pad * 2);
        }
    }
}
'@
}

$items = @(
  @{ Name = 'card-hero'; Width = 340; Height = 1200; Output = (Join-Path $docs 'screenshot-card.png') },
  @{ Name = 'card-today'; Width = 340; Height = 900 },
  @{ Name = 'card-quota'; Width = 340; Height = 900 },
  @{ Name = 'card-forecast'; Width = 340; Height = 900 },
  @{ Name = 'card-trend'; Width = 340; Height = 900 },
  @{ Name = 'card-models'; Width = 340; Height = 900 },
  @{ Name = 'settings-account'; Width = 680; Height = 900 },
  @{ Name = 'settings-display'; Width = 680; Height = 800 },
  @{ Name = 'settings-preview'; Width = 680; Height = 2000 },
  @{ Name = 'scenarios'; Html = (Join-Path $docs 'scenarios.html'); Width = 960; Height = 2700; Scale = 1.4; Pad = 28; Output = (Join-Path $docs 'scenarios.png') }
)

$profile = Join-Path $tmp 'edge-profile'
foreach ($item in $items) {
  $html = if ($item.Html) { $item.Html } else { Join-Path $shots "$($item.Name).html" }
  if (-not (Test-Path $html)) { throw "缺少 $html，请先运行 node docs/render-scenarios.cjs。" }
  $raw = Join-Path $tmp "$($item.Name).png"
  $out = if ($item.Output) { $item.Output } else { Join-Path $shots "$($item.Name).png" }
  $itemScale = if ($null -ne $item.Scale) { $item.Scale } else { $Scale }
  $pad = if ($null -ne $item.Pad) { $item.Pad } else { 32 }
  $url = ([System.Uri]$html).AbsoluteUri
  $edgeArgs = @(
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    "--user-data-dir=$profile",
    "--force-device-scale-factor=$itemScale",
    "--window-size=$($item.Width),$($item.Height)",
    '--virtual-time-budget=1500',
    "--screenshot=$raw",
    $url
  )
  & $Edge @edgeArgs | Out-Null
  if (-not (Test-Path $raw)) { throw "Edge 没有写出 $raw。" }
  [ShotTrim]::TrimPad($raw, $out, $pad, 3)
}

Write-Host "截图已写入 $shots"
