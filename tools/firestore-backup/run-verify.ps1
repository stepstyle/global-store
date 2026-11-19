# Restore + verify an EXISTING encrypted backup in a LOCAL emulator only. Does NOT read Firestore and needs no key.
#   powershell -ExecutionPolicy Bypass -File tools\firestore-backup\run-verify.ps1 -BackupFile C:\Users\<you>\dairsharaf-backups\firestore-<date>.fsbk
# The passphrase is typed into a hidden prompt and removed from this session at the end.
param([Parameter(Mandatory = $true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $BackupFile)) { throw 'Backup file not found.' }
$sec = Read-Host 'Backup passphrase' -AsSecureString
try {
  $env:BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new('', $sec).Password
  node (Join-Path $repo 'tools\firestore-backup\emulator-verify.mjs') $BackupFile
  if ($LASTEXITCODE -ne 0) { throw 'Local restore/verification FAILED: do not rely on this backup.' }
  Write-Host 'Verified: the backup restores completely (ok: true).'
} finally {
  Remove-Item Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $sec = $null
}
