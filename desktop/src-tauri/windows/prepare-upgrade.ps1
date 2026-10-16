# Short-term, fail-closed upgrade gate. Does not touch data, credentials or client settings.
param([string]$InstallDirectory, [string]$Language = '1033', [switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'

function Initialize-ProcessInspection {
    if ('RippleUpgradeImages' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RippleUpgradeImages {
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint size, uint flags);
 public static string ProcessImagePath(uint pid) {
  // Query-only access, including across 32/64-bit processes; never enable debug privilege.
  IntPtr h=OpenProcess(0x1000,false,pid); if(h==IntPtr.Zero) return null;
  try { uint size=32768; var path=new StringBuilder((int)size);
   return QueryFullProcessImageNameW(h,0,path,ref size) ? path.ToString() : null;
  } finally { CloseHandle(h); }
 }
 public static string CanonicalFile(string path) {
  if(string.IsNullOrEmpty(path)) return null;
  // Metadata access only; share read/write/delete so inspection does not hold an upgrade lock.
  using(var h=CreateFileW(path.Replace('/','\\'),0,7,IntPtr.Zero,3,0,IntPtr.Zero)) {
   if(h.IsInvalid) return null;
   var value=new StringBuilder(32768);
   uint length=GetFinalPathNameByHandleW(h,value,(uint)value.Capacity,0);
   return length>0 && length<value.Capacity ? value.ToString() : null;
  }
 }
}
'@
}
function Test-RippleImagePath([string]$Actual, [string]$Expected) {
    if (-not $Actual) { return $false }
    if ($Actual -ieq $Expected) { return $true }
    Initialize-ProcessInspection
    $actualFile = [RippleUpgradeImages]::CanonicalFile($Actual)
    $expectedFile = [RippleUpgradeImages]::CanonicalFile($Expected)
    return $actualFile -and $expectedFile -and ($actualFile -ieq $expectedFile)
}
function Get-RippleProcessKind($Process, [string]$Root) {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $exe = [string]$Process.ExecutablePath
    # WMI ExecutablePath requires debug privilege in some launch contexts. A null
    # property is not evidence that this is another installation's executable.
    if (-not $exe -and $Process.Name -in @('python.exe', 'ripple-desktop.exe')) {
        Initialize-ProcessInspection
        $exe = [RippleUpgradeImages]::ProcessImagePath([uint32]$Process.ProcessId)
    }
    if (Test-RippleImagePath $exe "$rootPath\ripple-desktop.exe") { return 'writer' }
    if (-not (Test-RippleImagePath $exe "$rootPath\backend\python\python.exe")) { return 'outside' }
    # Exact module mode only; -c, script paths and unrelated MCPs must not be killed.
    if ([string]$Process.CommandLine -match '(?i)^\s*(?:"[^"]+"|\S+)\s+(?:-B\s+)?-m\s+app\.connector_mcp(?:\s|$)') { return 'adapter' }
    return 'writer'
}
function Get-RippleProcesses([string]$Root) {
    # WMI access failure must fail closed. Do not print command lines or keys.
    @(Get-CimInstance Win32_Process | Where-Object { (Get-RippleProcessKind $_ $Root) -ne 'outside' })
}
function Get-SourceLabel($Process) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.ParentProcessId)"
    $name = if ($parent) { [IO.Path]::GetFileName([string]$parent.ExecutablePath) } else { 'unknown client' }
    "Ripple PID $($Process.ProcessId), parent $name (PID $($Process.ParentProcessId))"
}
function Stop-RippleAdapter($Candidate, [string]$Root) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Candidate.ProcessId)"
    if (-not $current) { return }
    if ($current.CreationDate -ne $Candidate.CreationDate -or (Get-RippleProcessKind $current $Root) -ne 'adapter') { throw 'Process identity changed; retry.' }
    $process = [Diagnostics.Process]::GetProcessById([int]$current.ProcessId)
    try {
        # Pin the native process handle, then compare its creation time; never kill a recycled PID.
        $null = $process.Handle
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $current.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 1) { throw 'Process identity changed; retry.' }
        if (@(Get-RippleProcesses $Root | Where-Object { (Get-RippleProcessKind $_ $Root) -eq 'writer' }).Count) { throw 'Ripple may still be saving. Save and exit normally, then retry.' }
        $process.Kill()
        if (-not $process.WaitForExit(5000)) { throw 'Ripple adapter did not exit; retry.' }
    } finally { $process.Dispose() }
}
function Initialize-LockOwners {
    if ('RippleUpgradeOwners' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RippleUpgradeOwners {
 [StructLayout(LayoutKind.Sequential)] struct Unique { public uint pid; public System.Runtime.InteropServices.ComTypes.FILETIME start; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Info {
  public Unique process;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
  public uint type, status, session; [MarshalAs(UnmanagedType.Bool)] public bool restart;
 }
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint h, int flags, StringBuilder key);
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint count, string[] files, uint apps, IntPtr processes, uint services, IntPtr names);
 [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint needed, ref uint count, [In,Out] Info[] list, ref uint reboot);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
 public static string Describe(string file) {
  uint h; if (RmStartSession(out h,0,new StringBuilder(33))!=0) return "unknown file owner";
  try {
   if(RmRegisterResources(h,1,new[]{file},0,IntPtr.Zero,0,IntPtr.Zero)!=0) return "unknown file owner";
   for(int attempt=0;attempt<3;attempt++) {
    uint needed,count=0,reboot=0; int r=RmGetList(h,out needed,ref count,null,ref reboot);
    if(r==0 && needed==0) return "unknown file owner";
    if(r!=234 || needed>4096) return "unknown file owner";
    var list=new Info[needed]; count=needed;
    r=RmGetList(h,out needed,ref count,list,ref reboot); if(r==234) continue;
    if(r!=0) return "unknown file owner";
    var labels=new string[count]; for(int i=0;i<count;i++) labels[i]=list[i].name+" (PID "+list[i].process.pid+")";
    return string.Join(", ",labels);
   }
   return "file owners changed; retry";
  } finally { RmEndSession(h); }
 }
}
'@
}
function Invoke-RippleUpgradeGate([string]$Root) {
    if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Invalid installation directory.' }
    if (-not (Test-Path -LiteralPath $Root)) { return }
    $rootItem = Get-Item -LiteralPath $Root
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation directory; cannot inspect safely.' }
    $resources = @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
    if (@($resources | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Linked resource; cannot inspect safely.' }
    $processes = @(Get-RippleProcesses $Root)
    $writers = @($processes | Where-Object { (Get-RippleProcessKind $_ $Root) -eq 'writer' })
    if ($writers.Count) { throw "Ripple may still be saving. Save and exit normally, then retry. $(Get-SourceLabel $writers[0])" }
    foreach ($adapter in $processes) { Stop-RippleAdapter $adapter $Root }
    # Do not fight a client's restart loop or stop its host. Let the user disable only Ripple.
    $remaining = @(Get-RippleProcesses $Root)
    if ($remaining.Count) { throw "Ripple process restarted or remains active. $(Get-SourceLabel $remaining[0])" }
    foreach ($file in $resources | Where-Object { -not $_.PSIsContainer }) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked resource; cannot inspect safely.' }
        try {
            $handle = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $handle.Dispose()
        } catch {
            Initialize-LockOwners
            $relative = $file.FullName.Substring($rootItem.FullName.Length).TrimStart('\')
            $owner = [RippleUpgradeOwners]::Describe($file.FullName)
            throw "Resource unavailable: $relative; $owner. Retry after releasing it, or cancel."
        }
    }
    # Close the scan/stop race as far as a short-term preflight can. Copy failures cannot be ignored.
    if (@(Get-RippleProcesses $Root).Count) { throw 'Ripple process restarted; disable only the Ripple connector and retry.' }
}
if (-not $LibraryOnly) {
    try { Invoke-RippleUpgradeGate $InstallDirectory; exit 0 }
    catch {
        # Exception messages here are deliberately classified; do not echo raw CIM/.NET exceptions.
        if ($Language -eq '2052') {
            if ($_.Exception.Message -match '^Ripple may still be saving') { Write-Output ('Ripple 可能仍在保存。请先保存并正常退出。' + ($_.Exception.Message -replace '^.*retry\. ', ' ')) }
            elseif ($_.Exception.Message -match '^Resource unavailable:') { Write-Output ($_.Exception.Message.Replace('Resource unavailable:', '文件无法安全替换：').Replace('Retry after releasing it, or cancel.', '请释放占用后重试，或安全取消。').Replace('unknown file owner','Windows 未能识别占用来源')) }
            elseif ($_.Exception.Message -match '^Ripple process restarted') { Write-Output 'Ripple 进程仍在运行或被客户端重新启动。请只停用客户端的 Ripple 连接器后重试。' }
            else { Write-Output '无法安全检查或释放 Ripple 文件。请先保存并正常退出 Ripple，然后重试或取消。' }
        }
        elseif ($_.Exception.Message -match '^(Ripple|Resource unavailable:|Process identity changed|Invalid installation|Linked)') { Write-Output $_.Exception.Message }
        else { Write-Output 'Unable to inspect or release Ripple resources safely. Close Ripple after saving, then retry or cancel.' }
        exit 20
    }
}
