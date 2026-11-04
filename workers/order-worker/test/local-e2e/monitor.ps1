# Socket monitor for the LOCAL e2e run (covers native processes the Node jail cannot see: workerd, java, the browser).
# Tracks every process descending from -RootPid (and keeps tracking it if its parent exits), and records any TCP
# connection of those processes whose remote address is not loopback. Read-only: never kills anything, never
# changes the firewall, never exempts any address (Microsoft, Google or otherwise).
#
# Process IDENTITY, not PID alone: Windows reuses PIDs. Each tracked process is recorded with its start time
# (CreationDate) and executable path. A connection is attributed to the test only after re-reading the owner at that
# moment and comparing identities:
#   same start time (+ same path when readable) -> "violation"   (a test process talked to the outside: FAIL)
#   provably different start time               -> "pid_reused"  (another program now owns that PID; logged with
#                                                                  BOTH identities as evidence, never silently dropped)
#   owner cannot be read                        -> "unverified"  (treated as a violation: FAIL)
# A child is adopted only if it started after its tracked parent and that parent PID still has the SAME identity
# (or has exited) - so children of an unrelated program that reused a parent's PID are never adopted.
param([int]$RootPid, [string]$OutFile, [int]$IntervalMs = 700)
$ErrorActionPreference = 'SilentlyContinue'
$tracked = @{}   # pid -> @{ name; created (UTC ISO, ms); path }
$reported = @{}
function Write-Line($obj) { Add-Content -Path $OutFile -Value ($obj | ConvertTo-Json -Compress) -Encoding utf8 }
function Now-Iso { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Is-Loopback([string]$a) {
  return ($a -eq '127.0.0.1' -or $a -eq '::1' -or $a -eq '0.0.0.0' -or $a -eq '::' -or $a -like '127.*' -or $a -like '::ffff:127.*')
}
function Created-Iso($p) {
  if ($null -eq $p -or $null -eq $p.CreationDate) { return $null }
  return ([datetime]$p.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}
function Identity($p) { return @{ name = "$($p.Name)"; created = (Created-Iso $p); path = "$($p.ExecutablePath)" } }
function Snapshot { Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath }
function Same-Identity($rec, $p) {
  if ($null -eq $p -or $null -eq $rec.created) { return $null }      # unknown
  $c = Created-Iso $p
  if ($null -eq $c) { return $null }
  if ($c -ne $rec.created) { return $false }
  if ($rec.path -and "$($p.ExecutablePath)" -and ("$($p.ExecutablePath)" -ne $rec.path)) { return $false }
  return $true
}

$root = Get-CimInstance Win32_Process -Filter "ProcessId=$RootPid" -Property ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath
$tracked[$RootPid] = (Identity $root)
Write-Line @{ type = 'start'; root = $RootPid; at = (Now-Iso); name = $tracked[$RootPid].name; created = $tracked[$RootPid].created }

while ($true) {
  $all = Snapshot
  $alive = @{}
  foreach ($p in $all) { $alive[[int]$p.ProcessId] = $p }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      $id = [int]$p.ProcessId
      $parent = [int]$p.ParentProcessId
      if ($tracked.ContainsKey($id) -or -not $tracked.ContainsKey($parent) -or $id -eq $parent) { continue }
      $prec = $tracked[$parent]
      # the parent PID must still be OUR parent (same identity) or gone; never adopt children of a PID re-user
      $parentNow = $alive[$parent]
      if ($null -ne $parentNow -and (Same-Identity $prec $parentNow) -eq $false) { continue }
      # a real child starts after its parent
      $cc = Created-Iso $p
      if ($null -ne $cc -and $null -ne $prec.created -and ([string]::CompareOrdinal($cc, $prec.created) -lt 0)) { continue }
      $tracked[$id] = (Identity $p)
      Write-Line @{ type = 'pid'; pid = $id; parent = $parent; name = $p.Name; created = $tracked[$id].created; path = $tracked[$id].path; at = (Now-Iso) }
      $changed = $true
    }
  }
  foreach ($c in (Get-NetTCPConnection)) {
    $owner = [int]$c.OwningProcess
    if (-not $tracked.ContainsKey($owner) -or "$($c.State)" -eq 'Listen' -or (Is-Loopback "$($c.RemoteAddress)")) { continue }
    $remote = "$($c.RemoteAddress):$($c.RemotePort)"
    $key = "$owner|$remote"
    if ($reported.ContainsKey($key)) { continue }
    $rec = $tracked[$owner]
    # re-read the owner NOW (the snapshot above may be a moment old)
    $now = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -Property ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath
    $same = Same-Identity $rec $now
    $current = if ($null -ne $now) { @{ name = "$($now.Name)"; created = (Created-Iso $now); path = "$($now.ExecutablePath)"; parent = [int]$now.ParentProcessId } } else { $null }
    $kind = if ($same -eq $true) { 'violation' } elseif ($same -eq $false) { 'pid_reused' } else { 'unverified' }
    $reported[$key] = $true
    Write-Line @{ type = $kind; pid = $owner; name = $rec.name; tracked = $rec; current = $current; remote = $remote; state = "$($c.State)"; at = (Now-Iso) }
  }
  if (-not $alive.ContainsKey($RootPid) -or (Test-Path "$OutFile.stop")) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
Write-Line @{ type = 'stop'; at = (Now-Iso) }
