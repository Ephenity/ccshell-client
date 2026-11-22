!define MUI_BGCOLOR "F7F5EF"
!define MUI_TEXTCOLOR "2B2925"
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_ABORTWARNING

!ifndef BUILD_UNINSTALLER
  !include FileFunc.nsh
  !macro preInit
    ${If} ${isUpdated}
      StrCpy $R0 $EXEDIR "" -23
      ${If} $R0 == "\.cache\updater\pending"
        StrCpy $R1 $EXEDIR -23
        GetFullPathName $R2 "$R1\.."
        StrCpy $R3 "$R2\.ccshell-update"
        Call ccRelaunchFrom
        ReadEnvStr $R2 "LOCALAPPDATA"
        StrCpy $R3 "$R2\Temp\.ccshell-update"
        Call ccRelaunchFrom
      ${EndIf}
    ${EndIf}
  !macroend

  Function ccRelaunchFrom
    RMDir /r "$R3"
    ClearErrors
    CreateDirectory "$R3\tmp"
    CopyFiles /SILENT "$EXEPATH" "$R3\setup.exe"
    IfErrors done
    IfFileExists "$R3\setup.exe" 0 done
    System::Call 'Kernel32::SetEnvironmentVariable(t "TEMP", t "$R3\tmp")'
    System::Call 'Kernel32::SetEnvironmentVariable(t "TMP", t "$R3\tmp")'
    ${GetParameters} $R4
    ClearErrors
    Exec '"$R3\setup.exe" $R4'
    IfErrors done
    Quit
    done:
  FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  Var ccDesktopBox
  Var ccDesktopLink

  !macro customPageAfterChangeDir
    Page custom ccOptionsPageCreate ccOptionsPageLeave

    Function ccOptionsPageCreate
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "附加选项" "选择安装时要做的额外设置。"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateCheckbox} 0 0 100% 12u "创建桌面快捷方式"
      Pop $ccDesktopBox
      ${If} $ccDesktopLink != "0"
        ${NSD_Check} $ccDesktopBox
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function ccOptionsPageLeave
      ${NSD_GetState} $ccDesktopBox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $ccDesktopLink "1"
      ${Else}
        StrCpy $ccDesktopLink "0"
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ${If} $ccDesktopLink == "0"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !macroend
!endif

!macro customRemoveFiles
  SetOutPath $TEMP
  StrCpy $R5 "keep"
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    ${If} ${FileExists} "$INSTDIR\data\*.*"
      ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除 CC Shell 的数据（账号、对话、设置、会话记录）？$\r$\n$\r$\n选择“否”将保留在：$\r$\n$INSTDIR\data$\r$\n重新安装到同一位置后可继续使用。" IDYES`
        StrCpy $R5 "all"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $R5 == "all"
    RMDir /r $INSTDIR
  ${Else}
    FindFirst $R6 $R7 "$INSTDIR\*.*"
    ${DoWhile} $R7 != ""
      ${If} $R7 != "."
      ${AndIf} $R7 != ".."
      ${AndIf} $R7 != "data"
      ${AndIf} $R7 != ".cache"
        ${If} ${FileExists} "$INSTDIR\$R7\*.*"
          RMDir /r "$INSTDIR\$R7"
        ${Else}
          Delete "$INSTDIR\$R7"
        ${EndIf}
      ${EndIf}
      FindNext $R6 $R7
    ${Loop}
    FindClose $R6
    RMDir $INSTDIR
  ${EndIf}
!macroend
