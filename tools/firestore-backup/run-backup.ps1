# Production Firestore backup — run by the OWNER in their own PowerShell, ONLY after approving it.
#   powershell -ExecutionPolicy Bypass -File tools\firestore-backup\run-backup.ps1 -KeyFile C:\Users\<you>\secure\fs-viewer.json -Project <project-id>
# - READ-ONLY: a "Cloud Datastore Viewer" key cannot write; the script also refuses any non-read request.
# - The passphrase is typed into a hidden prompt (not on the command line, not in the PowerShell history) and is
#   removed from this session at the end. The key file is read by Node only; nothing secret is printed.
# - Output: an encrypted .fsbk outside every git repository, readable by your Windows user only; then a restore +
#   full verification in a LOCAL emulator (never production).
param(
  [Parameter(Mandatory = $true)][string]$KeyFile,
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$OutDir = (Join-Path $env:USERPROFILE 'dairsharaf-backups')
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $KeyFile)) { throw 'Key file not found.' }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$out = Join-Path $OutDir ("firestore-{0}.fsbk" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

$sec = Read-Host 'Backup passphrase (16+ characters, keep it somewhere safe)' -AsSecureString
$sec2 = Read-Host 'Repeat the passphrase' -AsSecureString
$p1 = [System.Net.NetworkCredential]::new('', $sec).Password
$p2 = [System.Net.NetworkCredential]::new('', $sec2).Password
if ($p1 -ne $p2) { throw 'The passphrases do not match.' }
if ($p1.Length -lt 16) { throw 'The passphrase must be at least 16 characters.' }
try {
  $env:BACKUP_PASSPHRASE = $p1
  Write-Host "1/2 read-only backup of $Project ..."
  node (Join-Path $repo 'tools\firestore-backup\backup.mjs') backup --project $Project --owner-approved $Project --key-file $KeyFile --out $out
  if ($LASTEXITCODE -ne 0) { throw 'Backup failed (nothing was changed in Firestore).' }
  Write-Host "2/2 restore + verification in a LOCAL emulator ..."
  Push-Location $repo
  try { node (Join-Path $repo 'tools\firestore-backup\emulator-verify.mjs') $out } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'Local restore/verification FAILED: do not rely on this backup.' }
  Write-Host "Done. Encrypted backup: $out"
} finally {
  Remove-Item Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $p1 = $null; $p2 = $null
}
