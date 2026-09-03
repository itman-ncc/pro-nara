# ============================================================
#  deploy.ps1 — อัปเดต GitHub + Apps Script (deploy) อัตโนมัติ
#  วิธีใช้:  powershell -ExecutionPolicy Bypass -File deploy.ps1
#
#  หลักการ: push โค้ด -> สร้าง version ใหม่ -> ชี้ deployment เดิม
#  ไปที่ version ใหม่ (URL ของเว็บแอปคงเดิม ไม่ต้องแก้ index.html)
# ============================================================
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# Deployment ID ที่ใช้งานจริง (URL คงเดิม = .../s/AKfycbxLoXZYwzNwfNCKtjcRafSMVAt-QCCEYHXs3NBDTVjpVGcrJSCTWmLmpWVFH0ijPx98/exec)
$DeploymentId = 'AKfycbxLoXZYwzNwfNCKtjcRafSMVAt-QCCEYHXs3NBDTVjpVGcrJSCTWmLmpWVFH0ijPx98'
$WebAppURL = 'https://script.google.com/macros/s/' + $DeploymentId + '/exec'
$CommitMsg = "อัปเดตอัตโนมัติ " + (Get-Date -Format 'yyyy-MM-dd HH:mm')

Write-Host "`n=== 1/4 ตรวจสอบ syntax ===" -ForegroundColor Cyan
$html = Get-Content "$Root\index.html" -Raw
$m = [regex]::Match($html, '<script>([\s\S]*?)</script>')
if (-not $m.Success) { throw "ไม่พบ <script> ใน index.html" }
$tmp = Join-Path $env:TEMP "deploy_check.js"
$m.Groups[1].Value | Set-Content $tmp -Encoding UTF8
node --check $tmp; if ($LASTEXITCODE -ne 0) { throw "index.html JS syntax ผิด!" }
Get-ChildItem "$Root\apps-script\*.gs" | ForEach-Object {
  $t = Join-Path $env:TEMP ("gs_" + $_.BaseName + "_check.js")
  Copy-Item $_.FullName $t -Force
  node --check $t; if ($LASTEXITCODE -ne 0) { throw ("syntax ผิด: " + $_.Name) }
}
Write-Host "Syntax ผ่านเรียบร้อย" -ForegroundColor Green

Write-Host "`n=== 2/4 Commit + Push GitHub ===" -ForegroundColor Cyan
git add -A
$changed = (git status --short | Measure-Object -Line).Lines
if ($changed -gt 0) {
  git commit -m $CommitMsg
  git push origin main
  Write-Host "GitHub อัปเดตเรียบร้อย ($changed ไฟล์)" -ForegroundColor Green
} else {
  Write-Host "ไม่มีไฟล์เปลี่ยนแปลง - ข้าม commit/push" -ForegroundColor Yellow
}

Write-Host "`n=== 3/4 Push โค้ดขึ้น Apps Script + สร้าง version ===" -ForegroundColor Cyan
clasp push -f
if ($LASTEXITCODE -ne 0) { throw "clasp push ล้มเหลว!" }

$verOut = clasp version "auto $CommitMsg" 2>&1
Write-Host $verOut
$verNum = ($verOut | Select-String '(\d+)' | ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1)
if (-not $verNum) { $verNum = 'HEAD' }

clasp redeploy $DeploymentId -V $verNum
if ($LASTEXITCODE -ne 0) { throw "clasp deploy ล้มเหลว!" }
Write-Host "Deploy version $verNum เรียบร้อย (URL คงเดิม)" -ForegroundColor Green

Write-Host "`n=== 4/4 ตรวจสอบเว็บแอป ===" -ForegroundColor Cyan
Write-Host "URL: $WebAppURL" -ForegroundColor Green
try {
  $r = Invoke-WebRequest -Uri $WebAppURL -Method Post `
    -Body '{"action":"getConfig","payload":{},"session":{}}' `
    -ContentType 'text/plain;charset=utf-8' -TimeoutSec 30 -UseBasicParsing
  Write-Host "เว็บแอปตอบกลับ: $($r.StatusCode)" -ForegroundColor Green
  Write-Host ($r.Content.Substring(0, [Math]::Min(150, $r.Content.Length)))
} catch {
  Write-Host "ครั้งแรกหลัง deploy อาจ timeout (Apps Script กำลัง build) - ลองใหม่อีกครั้ง" -ForegroundColor Yellow
}

Write-Host "`n=== เสร็จสิ้น (ระบบเป็นปัจจุบันแล้ว) ===" -ForegroundColor Green
