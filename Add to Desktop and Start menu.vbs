' One-time setup: adds Money Desk shortcuts to the Desktop and Start menu.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
places = Array(sh.SpecialFolders("Desktop"), sh.SpecialFolders("Programs"))
For Each p In places
  Set lnk = sh.CreateShortcut(p & "\Money Desk.lnk")
  lnk.TargetPath = sh.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"
  lnk.Arguments = """" & dir & "\Money Desk.vbs"""
  lnk.WorkingDirectory = dir
  lnk.IconLocation = dir & "\money-desk.ico,0"
  lnk.Description = "Money Desk: private spending dashboard"
  lnk.Save
Next
MsgBox "Money Desk is now on your Desktop and in the Start menu." & vbCrLf & vbCrLf & "Open it from there. You can right-click it in the Start menu to pin it to the taskbar.", vbInformation, "Money Desk"
