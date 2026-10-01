; Cihaz Kontrol — önbellekli taşınabilir başlatıcı (tools/build-portable.mjs derler).
; Dosyalar %LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>'ye sürüm başına bir kez açılır;
; sonraki açılışlarda açma atlanır ve uygulama doğrudan başlatılır.
Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
Icon "${ICON}"
RequestExecutionLevel user
CRCCheck off
SetCompressor zlib
AutoCloseWindow true
ShowInstDetails nevershow
BrandingText " "

VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"

!define CACHE_ROOT "$LOCALAPPDATA\CihazKontrol"
!define APP_PATH "${CACHE_ROOT}\app-${BUILD_ID}"

Function .onInit
  ; Önbellek hazırsa hiçbir pencere gösterme
  ${If} ${FileExists} "${APP_PATH}\.ready"
  ${AndIf} ${FileExists} "${APP_PATH}\${APP_EXE}"
  ${AndIf} ${FileExists} "${APP_PATH}\resources\app.asar"
    SetSilent silent
  ${EndIf}
FunctionEnd

; Eski sürüm klasörlerini sil (kullanımdaki dosyalar sessizce atlanır)
Function CleanupOld
  FindFirst $1 $2 "${CACHE_ROOT}\app-*"
  loop:
    StrCmp $2 "" done
    StrCmp $2 "app-${BUILD_ID}" next
    RMDir /r "${CACHE_ROOT}\$2"
  next:
    FindNext $1 $2
    Goto loop
  done:
  FindClose $1
FunctionEnd

Section
  HideWindow
  ${IfNot} ${FileExists} "${APP_PATH}\.ready"
  ${OrIfNot} ${FileExists} "${APP_PATH}\${APP_EXE}"
  ${OrIfNot} ${FileExists} "${APP_PATH}\resources\app.asar"
    ; Eşzamanlı ilk açılışlar birbirinin yarım klasörünü silmesin
    System::Call 'kernel32::CreateMutex(p 0, i 0, t "CihazKontrol-Portable-${BUILD_ID}") p .r8'
    System::Call 'kernel32::WaitForSingleObject(p r8, i -1) i .r9'
    ${IfNot} ${FileExists} "${APP_PATH}\.ready"
    ${OrIfNot} ${FileExists} "${APP_PATH}\${APP_EXE}"
    ${OrIfNot} ${FileExists} "${APP_PATH}\resources\app.asar"
      Banner::show /NOUNLOAD "Cihaz Kontrol ilk kez hazırlanıyor…"
      RMDir /r "${APP_PATH}"
      RMDir /r "${APP_PATH}.tmp"
      CreateDirectory "${APP_PATH}.tmp"
      ; Electron 43 sandbox'ı kurulum klasöründe "ALL APPLICATION PACKAGES" okuma izni ister
      nsExec::Exec 'icacls "${APP_PATH}.tmp" /grant *S-1-15-2-1:(OI)(CI)(RX) /Q'
      Pop $0
      SetOutPath "${APP_PATH}.tmp"
      File /r "${APP_DIR}\*.*"
      SetOutPath "${CACHE_ROOT}"
      Rename "${APP_PATH}.tmp" "${APP_PATH}"
      FileOpen $0 "${APP_PATH}\.ready" w
      FileWrite $0 "${BUILD_ID}"
      FileClose $0
      Call CleanupOld
      Banner::destroy
    ${EndIf}
    System::Call 'kernel32::ReleaseMutex(p r8)'
    System::Call 'kernel32::CloseHandle(p r8)'
  ${EndIf}

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${PRODUCT_NAME}").r0'
  ${GetParameters} $R0
  SetOutPath "${APP_PATH}"
  Exec '"${APP_PATH}\${APP_EXE}" $R0'
SectionEnd
