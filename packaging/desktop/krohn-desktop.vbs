' KROHN Desktop — lanzador silencioso (sin ventana de consola).
Set sh = CreateObject("WScript.Shell")
script = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\krohn\krohn-desktop.ps1"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
