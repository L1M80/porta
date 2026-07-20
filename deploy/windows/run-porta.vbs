' Launches run-porta.bat with a fully hidden window (0 = hidden, False = don't wait).
' Resolves its own folder so it works regardless of where the repo is checked out.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run Chr(34) & here & "\run-porta.bat" & Chr(34), 0, False
