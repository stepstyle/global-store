# Socket monitor for the LOCAL e2e run (covers native processes the Node jail cannot see: workerd, java).
# Tracks every process descending from -RootPid (and keeps tracking it if its parent exits), and records
# any TCP connection of those processes whose remote address is not loopback. Read-only: never kills anything.
param([int]$RootPid, [string]$OutFile, [int]$IntervalMs = 700)
$ErrorActionPreference = 'SilentlyContinue'
$tracked = @{}
$tracked[$RootPid] = 'root'
$reported = @{}
function Write-Line($obj) { Add-Content -Path $OutFile -Value ($obj | ConvertTo-Json -Compress) -Encoding utf8 }
function Is-Loopback([string]$a) {
  return ($a -eq '127.0.0.1' -or $a -eq '::1' -or $a -eq '0.0.0.0' -or $a -eq '::' -or $a -like '127.*' -or $a -like '::ffff:127.*')
}
Write-Line @{ type = 'start'; root = $RootPid }
while ($true) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name
  $alive = @{}
  foreach ($p in $all) { $alive[[int]$p.ProcessId] = $p }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      $id = [int]$p.ProcessId
      if (-not $tracked.ContainsKey($id) -and $tracked.ContainsKey([int]$p.ParentProcessId) -and $id -ne [int]$p.ParentProcessId) {
        $tracked[$id] = $p.Name
        Write-Line @{ type = 'pid'; pid = $id; parent = [int]$p.ParentProcessId; name = $p.Name }
        $changed = $true
      }
    }
  }
  foreach ($c in (Get-NetTCPConnection)) {
    $owner = [int]$c.OwningProcess
    if ($tracked.ContainsKey($owner) -and "$($c.State)" -ne 'Listen' -and -not (Is-Loopback "$($c.RemoteAddress)")) {
      $key = "$owner|$($c.RemoteAddress)|$($c.RemotePort)"
      if (-not $reported.ContainsKey($key)) {
        $reported[$key] = $true
        Write-Line @{ type = 'violation'; pid = $owner; name = $tracked[$owner]; remote = "$($c.RemoteAddress):$($c.RemotePort)"; state = "$($c.State)" }
      }
    }
  }
  if (-not $alive.ContainsKey($RootPid) -or (Test-Path "$OutFile.stop")) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
Write-Line @{ type = 'stop' }
