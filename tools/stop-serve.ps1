# Detiene el servidor de pruebas: powershell -File tools/stop-serve.ps1 [puerto]
param([int]$Puerto = 8391)
$c = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $pid_ = ($c | Select-Object -First 1).OwningProcess
  Stop-Process -Id $pid_ -Force
  Write-Output "servidor de pruebas detenido (pid $pid_, puerto $Puerto)"
} else {
  Write-Output "el servidor ya no esta corriendo (puerto $Puerto)"
}
