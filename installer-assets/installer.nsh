; MediaDL custom NSIS hooks

; On every (re)install: wipe app-data so Electron's localStorage is cleared.
; localStorage stores setup_complete — clearing it forces the wizard to show again.
; For a brand-new install to a different folder this is a no-op (folder doesn't exist).
!macro customInstall
  RMDir /r "$INSTDIR\app-data"
!macroend

; On uninstall: remove all user-created folders so nothing is left behind.
!macro customUnInstall
  RMDir /r "$INSTDIR\app-data"
  RMDir /r "$INSTDIR\downloads"
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\scheduled.json"
  ; Also clean up the old default AppData location from pre-1.0 builds
  RMDir /r "$APPDATA\youtube-downloader-standalone"
!macroend
