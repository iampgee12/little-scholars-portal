; UCS Exam Server — Setup wizard (NSIS). Built by exam-app/build.js --installer:
;   makensis -DVERSION=1.0.0 -DBUILD=abc123 -DDIST=<dist dir> -DICON=<app-icon.ico> installer.nsi
; Installs for the current user, with Start menu and desktop shortcuts and an
; uninstaller listed in Windows "Apps & features". Only the one firewall rule
; (added the first time) asks Windows for permission.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
; draw at the screen's real resolution instead of being stretched (blurry) by Windows
ManifestDPIAware true

!define APP_NAME "UCS Exam Server"
!define APP_EXE "UCS Exam Server.exe"
!define PUBLISHER "Unique Group of Schools"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\UCSExamServer"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef BUILD
  !define BUILD "dev"
!endif

Name "${APP_NAME}"
OutFile "${DIST}/${APP_NAME} Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
; always this folder (no folder page): updates replace it whole, and Uninstall removes it
BrandingText "Unique Children's School"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Unique Children's School"

!include "MUI2.nsh"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
; school-branded pictures (drawn at twice the size, so they stay sharp on high-resolution screens)
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ART}/setup-welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ART}/setup-welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${ART}/setup-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${ART}/setup-header.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This installs the offline CBT exam server for Unique Children's School on this computer.$\r$\n$\r$\nPupils can then write their CBT over the school's Wi-Fi or a LAN cable, with no internet needed during the exam.$\r$\n$\r$\nThe first time, Windows asks once for permission so pupils' computers can connect: click Yes. Click Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME} now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\EXAM-SERVER-GUIDE.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the exam-day guide"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; the app can't be replaced while it is running (window or tray)
  retry:
  ClearErrors
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\engine\ucs-exam-engine.exe"
  IfErrors 0 +3
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running. Close it (choose Stop the exam server), or right-click its tray icon and choose Stop, then click Retry." IDRETRY retry
    Abort
  ; start from an empty folder so nothing from an older version is left behind
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${DIST}/app/*.*"
  File "${DIST}/EXAM-SERVER-GUIDE.txt"
  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Start the offline CBT exam server"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Exam-Day Guide.lnk" "$INSTDIR\EXAM-SERVER-GUIDE.txt"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall ${APP_NAME}.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Start the offline CBT exam server"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION} (${BUILD})"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" 340000

  ; Pupils connect over Wi-Fi or a LAN cable/switch. A switch with no internet is a
  ; "public" network to Windows, which blocks them unless the engine is allowed on
  ; every network type. Added once (Windows asks for permission); this also clears
  ; the "block on public networks" rule left by an earlier "Allow access" prompt.
  nsExec::ExecToStack 'netsh advfirewall firewall show rule name="${APP_NAME}"'
  Pop $0
  Pop $1
  StrCmp $0 0 fwdone
    ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall delete rule name=all dir=in program="$INSTDIR\engine\ucs-exam-engine.exe" & netsh advfirewall firewall add rule name="${APP_NAME}" dir=in action=allow program="$INSTDIR\engine\ucs-exam-engine.exe" protocol=TCP localport=8080 profile=any enable=yes' SW_HIDE
    nsExec::ExecToStack 'netsh advfirewall firewall show rule name="${APP_NAME}"'
    Pop $0
    Pop $1
    StrCmp $0 0 fwdone
    IfSilent fwdone
    MessageBox MB_OK|MB_ICONINFORMATION "Windows did not give permission, so pupils may only reach the exam server on Wi-Fi.$\r$\n$\r$\nTo let them connect with a LAN cable too, run this Setup again and click Yes when Windows asks."
  fwdone:
SectionEnd

Section "Uninstall"
  uretry:
  ClearErrors
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\engine\ucs-exam-engine.exe"
  IfErrors 0 +3
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running. Close it (choose Stop the exam server), or right-click its tray icon and choose Stop, then click Retry." IDRETRY uretry
    Abort
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APP_NAME}\*.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; the unpacked program files can always go; exam data only if the user says so
  RMDir /r "$LOCALAPPDATA\${APP_NAME}\app"
  IfSilent keepdata
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete this computer's exam data (loaded exam packs and any results not yet exported)?$\r$\n$\r$\nChoose No to keep it for next time." IDNO keepdata
    RMDir /r "$LOCALAPPDATA\${APP_NAME}"
  keepdata:
SectionEnd
