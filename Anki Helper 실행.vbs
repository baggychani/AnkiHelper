Option Explicit

Dim shell, fileSystem, root, pythonExe, appScript, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
pythonExe = fileSystem.BuildPath(root, ".venv\Scripts\python.exe")
appScript = fileSystem.BuildPath(root, "app.py")

If Not fileSystem.FileExists(pythonExe) Then
  MsgBox "The local .venv Python executable was not found.", vbExclamation, "Anki Helper"
  WScript.Quit 1
End If

If Not fileSystem.FileExists(appScript) Then
  MsgBox "app.py was not found next to this launcher.", vbExclamation, "Anki Helper"
  WScript.Quit 1
End If

' Chr(34) quotes both paths safely even when the workspace path has spaces.
shell.CurrentDirectory = root
command = Chr(34) & pythonExe & Chr(34) & " " & Chr(34) & appScript & Chr(34)
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  MsgBox "Anki Helper could not start. Run app.py in a terminal for details.", vbCritical, "Anki Helper"
End If
