# Draws the extension icon: two report pages, offset, with one band highlighted on the front page —
# a published layout and a changed one, with the difference standing out.
#
# Generated rather than sourced, so the artwork is original and carries no licence obligations.
#
#   powershell -File scripts\make-icon.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    return $path
}

# Background
$backdrop = New-RoundedPath 0 0 $size $size 56
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 35, 48))), $backdrop)

# Back page — the layout already published
$backPage = New-RoundedPath 40 46 118 152 14
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 120, 134, 152))), $backPage)

# Front page — the layout in the workspace
$frontPage = New-RoundedPath 92 62 124 158 14
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 246, 248, 251))), $frontPage)

# Content lines on the front page
$line = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 168, 178, 194))
foreach ($offset in 0, 1, 3, 4, 5) {
    $g.FillRectangle($line, 110, (86 + $offset * 22), 78, 8)
}

# The changed band — what the difference view would light up
$highlight = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 93, 61))
$g.FillRectangle($highlight, 110, 130, 88, 12)

$g.Dispose()

$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'media\icon.png'
$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "icon -> $target ($size x $size)"
