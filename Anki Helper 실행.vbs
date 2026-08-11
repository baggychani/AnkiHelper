Option Explicit

Dim shell, root, python, command
Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
python = root & "\.venv\Scripts\python.exe"

If Not CreateObject("Scripting.FileSystemObject").FileExists(python) Then
  MsgBox ".venv Python 환경을 찾지 못했습니다.", vbExclamation, "Anki Helper"
  WScript.Quit 1
End If

command = """" & python & """ """" & root & "\app.py""""
shell.Run command, 0, False
