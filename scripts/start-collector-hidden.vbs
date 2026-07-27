Option Explicit

Dim shell, fileSystem, scriptDirectory, powerShellScript, command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fileSystem.BuildPath(scriptDirectory, "start-collector.ps1")
command = "powershell.exe -NoLogo -NoProfile -NonInteractive " & _
  "-ExecutionPolicy Bypass -WindowStyle Hidden -File """ & _
  powerShellScript & """"

WScript.Quit shell.Run(command, 0, True)
