; UCS Exam Server — Setup wizard (NSIS). Built by exam-app/build.js --installer:
;   makensis -DVERSION=1.0.0 -DBUILD=abc123 -DDIST=<dist dir> -DICON=<app-icon.ico> installer.nsi
; Installs for the current user (no admin rights needed), with Start menu and
; desktop shortcuts and an uninstaller listed in Windows "Apps & features".

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

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
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
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
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This installs the offline CBT exam server for Unique Children's School on this computer.$\r$\n$\r$\nPupils can then write their CBT on the school's own Wi-Fi, with no internet needed during the exam.$\r$\n$\r$\nNo administrator password is needed. Click Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME} now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\EXAM-SERVER-GUIDE.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the exam-day guide"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  ; the app can't be replaced while its window is open
  retry:
  ClearErrors
  Delete "$INSTDIR\${APP_EXE}"
  IfErrors 0 +3
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running. Close its black window (this stops the exam server), then click Retry." IDRETRY retry
    Abort
  File "${DIST}/${APP_EXE}"
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
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" 110000
SectionEnd

Section "Uninstall"
  uretry:
  ClearErrors
  Delete "$INSTDIR\${APP_EXE}"
  IfErrors 0 +3
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running. Close its black window, then click Retry." IDRETRY uretry
    Abort
  Delete "$INSTDIR\EXAM-SERVER-GUIDE.txt"
  Delete "$INSTDIR\Uninstall ${APP_NAME}.exe"
  RMDir "$INSTDIR"
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
