; Keep electron-builder's stock installer/uninstaller generation and signing.
; The prepared directory retains all original flat templates; only its two
; shell-call files are modified, with explicitly recorded original hashes.
!include "${__FILEDIR__}\shell.nsh"
!cd "${__FILEDIR__}\..\..\artifacts\installer-templates"
