; MediaDL custom NSIS hooks
; Previously this wiped app-data which caused freezing and lost settings
!macro customInstall
  ; No-op to prevent installer freezing
!macroend

!macro customUnInstall
  ; Cleanup only what's necessary, avoid massive synchronous deletes that freeze the uninstaller
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\scheduled.json"
!macroend
