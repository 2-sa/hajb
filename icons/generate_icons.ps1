Add-Type -AssemblyName System.Drawing
$sizes = @(16, 48, 128)
$blue = [System.Drawing.Color]::FromArgb(255, 29, 155, 240)
$white = [System.Drawing.Color]::White

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    
    $bgBrush = New-Object System.Drawing.SolidBrush($blue)
    $g.FillEllipse($bgBrush, 0, 0, $s, $s)
    
    $margin = [float]($s / 4.0)
    $innerSize = [float]($s - ($margin * 2.0))
    $pen = New-Object System.Drawing.Pen($white, [float]($s / 12.0))
    
    $g.DrawEllipse($pen, $margin, $margin, $innerSize, $innerSize)
    
    $offset = [float]($innerSize * 0.146)
    $g.DrawLine($pen, [float]($margin + $offset), [float]($margin + $offset), [float]($s - $margin - $offset), [float]($s - $margin - $offset))
    
    $bmp.Save("C:\Users\windows11\.gemini\antigravity\scratch\OneClickBlock\icons\icon$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}
