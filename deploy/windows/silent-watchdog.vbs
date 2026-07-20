' Runs porta-watchdog.ps1 fully hidden. This is the entry point the scheduled task
' invokes (wscript.exe silent-watchdog.vbs) so no console window ever flashes.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run _
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & here & "\porta-watchdog.ps1" & Chr(34), 0, False
