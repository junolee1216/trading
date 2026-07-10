$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonScript = Join-Path $ScriptDir "scripts\refresh_data.py"

python $PythonScript
if ($LASTEXITCODE -ne 0) {
  throw "Data refresh failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Data refresh complete. Open http://127.0.0.1:4173/index.html and press Ctrl+F5 if needed."
