' PoE2 Overlay — silent launcher (no console window).
' First run / after updates: use "Start PoE2 Overlay.cmd" instead (it installs
' dependencies and builds, with visible output). This one just starts the app.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Dependencies missing." & vbCrLf & "Run 'Start PoE2 Overlay.cmd' once first.", 48, "PoE2 Overlay"
  WScript.Quit 1
End If
If Not fso.FileExists(root & "\dist\main.js") Then
  MsgBox "App not built." & vbCrLf & "Run 'Start PoE2 Overlay.cmd' once first.", 48, "PoE2 Overlay"
  WScript.Quit 1
End If
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run """" & exe & """ .", 1, False
