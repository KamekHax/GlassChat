!include "WordFunc.nsh"
!insertmacro VersionCompare

!macro customInit
  ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} "$R0" "${VERSION}" $R1
    ${If} $R1 == "1"
      ${If} ${Silent}
        SetErrorLevel 1
      ${EndIf}
      MessageBox MB_ICONSTOP|MB_TOPMOST "A newer GlassChat version ($R0) is already installed. This setup is version ${VERSION} and cannot downgrade it."
      Abort
    ${EndIf}
  ${EndIf}
!macroend
