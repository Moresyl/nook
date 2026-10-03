; Qiyao shell integration using NSIS's original open source System plugin.
; Interface definitions come from the Windows SDK; NSIS headers retain their
; original license under licenses/distribution/nsis/COPYING.
!ifndef QIYAO_SHELL_INCLUDED
!define QIYAO_SHELL_INCLUDED
!include LogicLib.nsh
!include Win\COM.nsh
!include Win\Propkey.nsh

Var /GLOBAL qiyaoShellResult
Var /GLOBAL qiyaoShellIdValid

!macro QiyaoValidateAppID appId
  StrCpy $qiyaoShellResult -2147024809
  StrCpy $qiyaoShellIdValid 0
  StrLen $9 "${appId}"
  ${If} $9 > 0
  ${AndIf} $9 <= 128
    StrCpy $qiyaoShellIdValid 1
    StrCpy $6 0
    ${DoWhile} $6 < $9
      StrCpy $7 "${appId}" 1 $6
      ${If} $7 == " "
        StrCpy $qiyaoShellIdValid 0
        ${ExitDo}
      ${EndIf}
      IntOp $6 $6 + 1
    ${Loop}
  ${EndIf}
!macroend

; System::Store preserves the caller's registers. The result is an HRESULT.
; CoUninitialize must only balance a successful CoInitializeEx, including S_FALSE.
!macro QiyaoShellBegin
  System::Store S
  StrCpy $qiyaoShellResult -2147467259
  System::Call 'ole32::CoInitializeEx(p 0, i 2)i.r8'
!macroend

!macro QiyaoShellEnd
  ${If} $8 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  ${If} $qiyaoShellResult < 0
    DetailPrint "Shell integration returned HRESULT $qiyaoShellResult"
  ${EndIf}
  System::Store L
!macroend

!macro QiyaoSetShortcutAppID shortcut appId
  !insertmacro QiyaoShellBegin
  !insertmacro QiyaoValidateAppID "${appId}"
  ${If} $qiyaoShellIdValid == 1
  StrCpy $0 0
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLinkW} r0 '.r9'
  ${If} $0 P<> 0
    StrCpy $1 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)i.r9'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("${shortcut}",2)i.r9'
      ${If} $9 >= 0
        StrCpy $2 0
        ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)i.r9'
        ${If} $2 P<> 0
          System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
          System::Call '*(&w${NSIS_MAX_STRLEN} "${appId}")p.r4'
          ; The x86 NSIS PROPVARIANT has an eight-byte header and union.
          System::Call '*(&i2 ${VT_LPWSTR},&i2 0,&i2 0,&i2 0,p r4,p 0)p.r5'
          ${If} $3 P<> 0
          ${AndIf} $4 P<> 0
          ${AndIf} $5 P<> 0
            ${IPropertyStore::SetValue} $2 '($3,$5)i.r9'
            ${If} $9 >= 0
              ${IPropertyStore::Commit} $2 '()i.r9'
              ${If} $9 >= 0
                ${IPersistFile::Save} $1 '("${shortcut}",1)i.r9'
              ${EndIf}
            ${EndIf}
          ${Else}
            StrCpy $9 -2147024882
          ${EndIf}
          System::Free $5
          System::Free $4
          System::Free $3
          ${IUnknown::Release} $2 ''
        ${EndIf}
      ${EndIf}
      ${IUnknown::Release} $1 ''
    ${EndIf}
    ${IUnknown::Release} $0 ''
  ${EndIf}
  StrCpy $qiyaoShellResult $9
  ${EndIf}
  !insertmacro QiyaoShellEnd
!macroend

!macro QiyaoUnpinShortcut shortcut
  !insertmacro QiyaoShellBegin
  StrCpy $0 0
  System::Call 'shell32::SHCreateItemFromParsingName(w "${shortcut}",p 0,g "${IID_IShellItem}",*p.r0)i.r9'
  ${If} $0 P<> 0
    StrCpy $1 0
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_StartMenuPin} ${IID_IStartMenuPinnedList} r1 '.r9'
    ${If} $1 P<> 0
      ${IStartMenuPinnedList::RemoveFromList} $1 '($0)i.r9'
      ${IUnknown::Release} $1 ''
    ${EndIf}
    ${IUnknown::Release} $0 ''
  ${EndIf}
  StrCpy $qiyaoShellResult $9
  !insertmacro QiyaoShellEnd
!macroend

!macro QiyaoClearAppDestinations appId
  !insertmacro QiyaoShellBegin
  !insertmacro QiyaoValidateAppID "${appId}"
  ${If} $qiyaoShellIdValid == 1
  StrCpy $0 0
  ; ICustomDestinationList::DeleteList (vtable slot 10).
  !insertmacro ComHlpr_CreateInProcInstance {77F10CF0-3DB5-4966-B520-B7C54FD35ED6} {6332DEBF-87B5-4670-90C0-5E57B408A49E} r0 '.r9'
  ${If} $0 P<> 0
    System::Call '$0->10(w "${appId}")i.r9'
    ${IUnknown::Release} $0 ''
  ${EndIf}
  StrCpy $qiyaoShellResult $9
  StrCpy $0 0
  ; IApplicationDestinations::SetAppID and RemoveAllDestinations (slots 3, 5).
  !insertmacro ComHlpr_CreateInProcInstance {86C14003-4D6B-4EF3-A7B4-0506663B2E68} {12337D35-94C6-48A0-BCE7-6A9C69D4D600} r0 '.r9'
  ${If} $0 P<> 0
    System::Call '$0->3(w "${appId}")i.r9'
    ${If} $9 >= 0
      System::Call '$0->5()i.r9'
    ${EndIf}
    ${IUnknown::Release} $0 ''
  ${EndIf}
  ${If} $qiyaoShellResult >= 0
    StrCpy $qiyaoShellResult $9
  ${EndIf}
  ${EndIf}
  !insertmacro QiyaoShellEnd
!macroend
!endif
