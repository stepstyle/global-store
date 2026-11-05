# Windows only, LOCAL test helper (test/staging/stop-cleanup.test.mjs): starts a Node child in its OWN console process
# group (same console), waits for "READY" in its log, sends it a REAL Ctrl+Break console event
# (GenerateConsoleCtrlEvent CTRL_BREAK_EVENT -> Node 'SIGBREAK'), then prints "EXIT <code>" or "TIMEOUT".
# Ctrl+C cannot be targeted at one process group (Windows disables it in a new group), so only Ctrl+Break is sent.
# No network; the child is terminated if it does not exit in time.
param([string]$Node, [string]$Script, [string]$ArgsLine, [string]$LogFile, [int]$ReadyMs = 15000, [int]$ExitMs = 40000)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StagingConCtl {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO { public int cb; public string r; public string d; public string t; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
}
'@
$si = New-Object StagingConCtl+STARTUPINFO; $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
$pi = New-Object StagingConCtl+PROCESS_INFORMATION
$CREATE_NEW_PROCESS_GROUP = 0x200
$cmd = "`"$Node`" `"$Script`" $ArgsLine"
if (-not [StagingConCtl]::CreateProcess([NullString]::Value, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, $CREATE_NEW_PROCESS_GROUP, [IntPtr]::Zero, [NullString]::Value, [ref]$si, [ref]$pi)) {
  "CREATE_FAILED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 2
}
try {
  $deadline = (Get-Date).AddMilliseconds($ReadyMs)
  while ((Get-Date) -lt $deadline -and -not ((Test-Path $LogFile) -and ((Get-Content $LogFile -Raw) -match 'READY'))) { Start-Sleep -Milliseconds 100 }
  if (-not ((Test-Path $LogFile) -and ((Get-Content $LogFile -Raw) -match 'READY'))) { [void][StagingConCtl]::TerminateProcess($pi.hProcess, 98); "NOT_READY"; exit 3 }
  $sent = (Get-Date)
  if (-not [StagingConCtl]::GenerateConsoleCtrlEvent(1, [uint32]$pi.pid)) { [void][StagingConCtl]::TerminateProcess($pi.hProcess, 97); "SEND_FAILED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 4 }
  if ([StagingConCtl]::WaitForSingleObject($pi.hProcess, [uint32]$ExitMs) -ne 0) { [void][StagingConCtl]::TerminateProcess($pi.hProcess, 99); "TIMEOUT"; exit 5 }
  $code = 0; [void][StagingConCtl]::GetExitCodeProcess($pi.hProcess, [ref]$code)
  "EXIT $code AFTER_MS $([int]((Get-Date) - $sent).TotalMilliseconds)"
} finally {
  [void][StagingConCtl]::CloseHandle($pi.hThread); [void][StagingConCtl]::CloseHandle($pi.hProcess)
}
