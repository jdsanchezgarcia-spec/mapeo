$c = Get-NetTCPConnection -LocalPort 8391 -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $pid_ = ($c | Select-Object -First 1).OwningProcess
  Stop-Process -Id $pid_ -Force
  Write-Output "servidor de pruebas detenido (pid $pid_)"
} else {
  Write-Output "el servidor ya no esta corriendo"
}
