# Money Desk: serves the app on this computer only (http://localhost:8789), saves your data
# to data\money-desk.json next to this script, and opens the app in its own window.
# Runs hidden. Starts with the window and stops a few seconds after the window closes.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'app'
$dataDir = Join-Path $PSScriptRoot 'data'
$dataFile = Join-Path $dataDir 'money-desk.json'
$backupDir = Join-Path $dataDir 'backups'
# A new random key each time the helper starts. Only the window this helper opens is given it,
# so websites and other Windows accounts on this computer can't read or change your data.
# (Programs running as you can read the data folder anyway; that is outside what this protects.)
$keyFile = Join-Path $dataDir 'session.key'
$maxBody = 64MB
$keepBackups = 30
$keepOpenBackups = 20
$openBackupDone = $false
$port = 8789
$prefix = "http://localhost:$port/"
$origin = "http://localhost:$port"
$version = '9'
# Safety net if the window never says goodbye (for example, the browser crashed).
$idleLimit = [TimeSpan]::FromMinutes(10)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.svg' = 'image/svg+xml'; '.css' = 'text/css'
}

function New-Key {
  $b = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  $rng.Dispose()
  return ([BitConverter]::ToString($b) -replace '-', '').ToLower()
}

function Open-Window([string]$key) {
  # The key goes after #, so the browser keeps it in the window and never sends it in a URL.
  $url = "$prefix#k=$key"
  $browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $exe = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  # Returns $true only when it opened an app window, the only kind that can get the badge below.
  try {
    if ($exe) { Start-Process -FilePath $exe -ArgumentList "--app=$url", '--window-size=1440,920'; return $true }
    Start-Process $url
  } catch { }
  return $false
}

# The window belongs to Edge, so Windows would show (and pin) it as Edge. Once it appears, give it
# Money Desk's own taskbar identity: its icon, its name, and Money Desk.vbs as what a pin starts.
$badgeScript = {
  param([string]$dir, [bool]$stamp)
  # Nothing here is needed for Money Desk to work, so a failure only leaves a line in this log
  # (and the window keeps the Edge icon).
  $ErrorActionPreference = 'Stop'
  $log = Join-Path $dir 'data\taskbar-icon.log'
  trap { try { Add-Content -LiteralPath $log -Value ('{0:s} {1}' -f (Get-Date), $_) } catch { }; return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MoneyDeskWindow {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindCtx, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint count);
    int GetAt(uint i, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
    int SetValue(ref PropertyKey key, ref PropVariant value);
    int Commit();
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PropertyKey { public Guid fmtid; public uint pid; }
  // 24 bytes: the size on 64-bit Windows (32-bit uses 16 and ignores the rest).
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr str; }

  static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  static Guid StoreIid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");  // IPropertyStore

  // The app window's title is the page title; normal browser windows add " - Microsoft Edge".
  // Windows that already carry the id are skipped, so a second window gets badged too.
  public static IntPtr Find(string id) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      var title = new StringBuilder(128); GetWindowText(h, title, 128);
      if (cls.ToString() != "Chrome_WidgetWin_1" || title.ToString() != "Money Desk") return true;
      if (!IsBrowser(h) || CurrentId(h) == id) return true;
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }

  // The browsers Open-Window can start.
  static bool IsBrowser(IntPtr hwnd) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    try {
      var name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
      return name == "msedge" || name == "chrome";
    } catch { return false; }
  }

  static string CurrentId(IntPtr hwnd) {
    IPropertyStore store;
    if (SHGetPropertyStoreForWindow(hwnd, ref StoreIid, out store) != 0 || store == null) return null;
    try {
      var key = new PropertyKey { fmtid = AppUserModel, pid = 5 };
      PropVariant v;
      if (store.GetValue(ref key, out v) != 0) return null;
      try { return v.vt == 31 ? Marshal.PtrToStringUni(v.str) : null; } finally { PropVariantClear(ref v); }
    } finally { Marshal.ReleaseComObject(store); }
  }

  static void Set(IPropertyStore store, uint pid, string value) {
    var key = new PropertyKey { fmtid = AppUserModel, pid = pid };
    var v = new PropVariant { vt = 31 /* VT_LPWSTR */, str = Marshal.StringToCoTaskMemUni(value) };
    try { store.SetValue(ref key, ref v); } finally { Marshal.FreeCoTaskMem(v.str); }
  }

  public static bool Badge(IntPtr hwnd, string id, string command, string icon, string name) {
    IPropertyStore store;
    if (SHGetPropertyStoreForWindow(hwnd, ref StoreIid, out store) != 0 || store == null) return false;
    try {
      Set(store, 2, command);  // RelaunchCommand: what a taskbar pin starts
      Set(store, 3, icon);     // RelaunchIconResource
      Set(store, 4, name);     // RelaunchDisplayNameResource
      Set(store, 5, id);       // AppUserModel.ID, set last so Windows reads the others with it
      store.Commit();
      return true;
    } finally { Marshal.ReleaseComObject(store); }
  }

  // Gives a shortcut the same identity, so it and the window share one taskbar button.
  public static bool StampShortcut(string path, string id) {
    IPropertyStore store;
    if (SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2 /* GPS_READWRITE */, ref StoreIid, out store) != 0 || store == null) return false;
    try { Set(store, 5, id); store.Commit(); return true; }
    finally { Marshal.ReleaseComObject(store); }
  }
}
'@
  $vbs = Join-Path $dir 'Money Desk.vbs'
  $command = '"' + (Join-Path $env:WINDIR 'System32\wscript.exe') + '" "' + $vbs + '"'
  $icon = (Join-Path $dir 'money-desk.ico') + ',0'
  # Wait up to 30 seconds for the window to open and show its title.
  $badged = $false
  for ($i = 0; $i -lt 60 -and -not $badged; $i++) {
    $h = [MoneyDeskWindow]::Find('MoneyDesk.App')
    if ($h -ne [IntPtr]::Zero) { $badged = [MoneyDeskWindow]::Badge($h, 'MoneyDesk.App', $command, $icon, 'Money Desk') }
    else { Start-Sleep -Milliseconds 500 }
  }
  if (-not $badged) { Add-Content -LiteralPath $log -Value ('{0:s} the Money Desk window was not found or could not be badged' -f (Get-Date)) }
  # Money Desk shortcuts on the Desktop, in the Start menu and pinned to the taskbar
  # (once per helper start; a second window needs only its own badge, and shortcuts made
  # while the helper runs are stamped at its next start).
  if (-not $stamp) { return }
  $sh = New-Object -ComObject WScript.Shell
  $places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
  foreach ($p in $places) {
    Get-ChildItem -LiteralPath $p -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
      $lnkArgs = try { $sh.CreateShortcut($_.FullName).Arguments } catch { '' }
      if ($lnkArgs -and $lnkArgs.IndexOf($vbs, [StringComparison]::OrdinalIgnoreCase) -ge 0) { [void][MoneyDeskWindow]::StampShortcut($_.FullName, 'MoneyDesk.App') }
    }
  }
}

# Runs the step above beside the helper, so the helper can serve the page while it waits.
function Start-WindowBadge([switch]$Wait) {
  try {
    $ps = [PowerShell]::Create().AddScript($badgeScript).AddArgument($PSScriptRoot).AddArgument(-not $Wait)
    if ($Wait) { [void]$ps.Invoke(); $ps.Dispose() } else { [void]$ps.BeginInvoke() }
  } catch { }
}

# Sites the download guide links to. Only these can be opened through /api/open.
$linkHosts = @(
  'www.onlinesbi.sbi', 'netbanking.kotak.com', 'netbanking.hdfcbank.com', 'www.icicibank.com', 'www.sbicard.com',
  'www.camsonline.com', 'mfs.kfintech.com', 'www.amfiindia.com', 'nsdl.com', 'groww.in', 'www.wealthy.in',
  'www.cibil.com', 'www.experian.in', 'www.bhimupi.org.in', 'upihelp.npci.org.in'
)

# Opens a guide link in your usual browser: Chrome when installed, otherwise the Windows default.
# The app window itself stays in its own browser window; only https links to the sites above open.
function Open-Link($req, $res) {
  $o = $req.Headers['Origin']
  if ($req.HttpMethod -ne 'POST' -or ($o -and $o -ne $origin) -or -not (Test-Key $req)) { $res.StatusCode = 403; return }
  if ($req.ContentLength64 -le 0 -or $req.ContentLength64 -gt 2048) { $res.StatusCode = 413; return }
  $text = (New-Object System.IO.StreamReader($req.InputStream, $utf8)).ReadToEnd()
  $uri = $null
  if (-not [Uri]::TryCreate($text.Trim(), [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
      $uri.UserInfo -or -not $uri.IsDefaultPort -or $linkHosts -notcontains $uri.Host.ToLower()) { $res.StatusCode = 400; return }
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  # AbsoluteUri is fully escaped (no spaces or quotes), so it reaches the browser as one argument.
  try {
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $uri.AbsoluteUri }
    else { Start-Process $uri.AbsoluteUri }
    $res.StatusCode = 204
  } catch {
    # The page then opens the link itself.
    $res.StatusCode = 502
  }
}

function Send-Text($res, [int]$status, [string]$text, [string]$type) {
  $res.StatusCode = $status
  $res.ContentType = $type
  $bytes = $utf8.GetBytes($text)
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Keeps a copy of the data file from before its first change each day (last 30 days), and
# one from before the first change each time Money Desk is opened (last 20 opens), so a
# change made right after an update can be undone the same day.
function Save-Backups {
  if (-not (Test-Path $dataFile)) { return }
  if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
  $daily = Join-Path $backupDir ("money-desk-{0}.json" -f (Get-Date -Format 'yyyy-MM-dd'))
  if (-not (Test-Path $daily)) { Copy-Item $dataFile $daily }
  Get-ChildItem $backupDir -Filter 'money-desk-*.json' | Sort-Object Name -Descending |
    Select-Object -Skip $keepBackups | Remove-Item -Force
  if (-not $script:openBackupDone) {
    Copy-Item $dataFile (Join-Path $backupDir ("opened-{0}.json" -f (Get-Date -Format 'yyyy-MM-dd-HHmmss')))
    $script:openBackupDone = $true
    Get-ChildItem $backupDir -Filter 'opened-*.json' | Sort-Object Name -Descending |
      Select-Object -Skip $keepOpenBackups | Remove-Item -Force
  }
}

# True when the request carries this run's key in the X-Money-Desk header.
function Test-Key($req) {
  $k = $req.Headers['X-Money-Desk']
  return [bool]($k -and $k -ceq $key)
}

function Handle-Data($req, $res) {
  # Only the Money Desk window may use the data API. The custom header also forces browsers to
  # ask permission first for any other site, which this server never grants.
  $o = $req.Headers['Origin']
  if (($o -and $o -ne $origin) -or -not (Test-Key $req)) { Send-Text $res 403 'forbidden' 'text/plain'; return }
  if ($req.HttpMethod -eq 'GET') {
    if (Test-Path $dataFile) { Send-Text $res 200 ([IO.File]::ReadAllText($dataFile, $utf8)) 'application/json' }
    else { Send-Text $res 404 '{}' 'application/json' }
    return
  }
  if ($req.HttpMethod -eq 'PUT') {
    if ($req.ContentLength64 -le 0 -or $req.ContentLength64 -gt $maxBody) { Send-Text $res 413 'too large' 'text/plain'; return }
    $reader = New-Object System.IO.StreamReader($req.InputStream, $utf8)
    $body = $reader.ReadToEnd()
    $reader.Close()
    if (-not $body.StartsWith('{') -or -not $body.Contains('"txns"')) { Send-Text $res 400 'bad data' 'text/plain'; return }
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
    Save-Backups
    # Write to a temp file first so a crash never leaves a half-written data file.
    $tmp = "$dataFile.tmp"
    [IO.File]::WriteAllText($tmp, $body, $utf8)
    if (Test-Path $dataFile) { [IO.File]::Replace($tmp, $dataFile, [NullString]::Value) } else { [IO.File]::Move($tmp, $dataFile) }
    Send-Text $res 200 '{"ok":true}' 'application/json'
    return
  }
  Send-Text $res 405 'method not allowed' 'text/plain'
}

function Start-Listener {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add($prefix)
  try { $l.Start(); return $l } catch { return $null }
}

$listener = Start-Listener
if (-not $listener) {
  # Something is already serving Money Desk. If it is this version, just open a window.
  $running = try { (Invoke-WebRequest "${prefix}__version" -UseBasicParsing -TimeoutSec 3).Content } catch { '' }
  if ("$running".Trim() -eq $version) {
    $k = try { [IO.File]::ReadAllText($keyFile).Trim() } catch { '' }
    if (Open-Window $k) { Start-WindowBadge -Wait }
    exit
  }
  # Otherwise it is an older helper: stop it and take over.
  try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($PSCommandPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  } catch { }
  Start-Sleep -Seconds 1
  $listener = Start-Listener
  if (-not $listener) { exit }
}
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$key = New-Key
[IO.File]::WriteAllText($keyFile, $key, $utf8)
if (Open-Window $key) { Start-WindowBadge }
$last = Get-Date
$byeAt = $null
$pages = @{}   # open Money Desk windows, by the id each page picks for itself

try {
  while ($true) {
    $ar = $listener.BeginGetContext($null, $null)
    while (-not $ar.AsyncWaitHandle.WaitOne(1000)) {
      # The window said goodbye and nothing reloaded it within a few seconds: stop.
      if ($byeAt -and $last -le $byeAt -and ((Get-Date) - $byeAt).TotalSeconds -ge 4) { return }
      if ((Get-Date) - $last -gt $idleLimit) { return }
    }
    $ctx = $listener.EndGetContext($ar)
    $last = Get-Date
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      # Only this computer may connect, even if the firewall would let others in.
      if (-not $req.IsLocal) { $res.StatusCode = 403; continue }
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      # Control endpoints answer only the Money Desk page itself, not other websites.
      if ($path.StartsWith('/__') -or $path.StartsWith('/api/')) {
        $site = $req.Headers['Sec-Fetch-Site']
        if ($site -and $site -ne 'same-origin') { $res.StatusCode = 403; continue }
      }
      if (($path -eq '/__alive' -or $path -eq '/__bye') -and -not (Test-Key $req)) { $res.StatusCode = 403; continue }
      $pageId = $req.QueryString['id']
      if ($path -eq '/__alive') {
        if ($pageId) { $pages[$pageId] = Get-Date }
        $res.StatusCode = 204
        continue
      }
      if ($path -eq '/__version') { Send-Text $res 200 $version 'text/plain'; continue }
      if ($path -eq '/__bye') {
        $o = $req.Headers['Origin']
        if ($req.HttpMethod -eq 'POST' -and (-not $o -or $o -eq $origin)) {
          if ($pageId) { $pages.Remove($pageId) }
          # Stop only when the last window has closed.
          if ($pages.Count -eq 0) { $byeAt = Get-Date }
        }
        $res.StatusCode = 204
        continue
      }
      if ($path -eq '/api/data') { Handle-Data $req $res; continue }
      if ($path -eq '/api/open') { Open-Link $req $res; continue }
      if ($req.HttpMethod -ne 'GET') { $res.StatusCode = 405; continue }
      $rel = $path.TrimStart('/') -replace '/', [IO.Path]::DirectorySeparatorChar
      $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
      # Unknown paths and anything outside the app folder fall back to index.html.
      $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $file.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
        $file = Join-Path $root 'index.html'
      }
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.OutputStream.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
  try { Remove-Item $keyFile -Force } catch { }
}
