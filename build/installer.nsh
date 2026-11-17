!define MUI_BGCOLOR "F7F5EF"
!define MUI_TEXTCOLOR "2B2925"
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_ABORTWARNING

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
