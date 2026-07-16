$folder = 'C:\Users\iannc\Downloads\you seem pretty sad for a girl so in love'
$ini = "[.ShellClassInfo]`r`nIconResource=C:\Windows\System32\shell32.dll,43`r`n[ViewState]`r`nMode=`r`nVid=`r`nFolderType=Music`r`n"
Set-Content -Path "$folder\desktop.ini" -Value $ini -Encoding Ascii -Force
attrib +s "$folder"
attrib +s +h "$folder\desktop.ini"
ie4uinit.exe -show
