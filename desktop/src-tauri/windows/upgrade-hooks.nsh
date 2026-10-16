; Run only our shipped preflight. Never invoke shell text derived from a process.
!define RIPPLE_UPGRADE_SCRIPT "${__FILEDIR__}\prepare-upgrade.ps1"
!macro RipplePreflight PREFIX
Function ${PREFIX}RipplePrepareUpgrade
  Push $0
  Push $1
  Push $2
  InitPluginsDir
  File /oname=$PLUGINSDIR\ripple-prepare-upgrade.ps1 "${RIPPLE_UPGRADE_SCRIPT}"
  System::Call 'kernel32::SetEnvironmentVariable(t "RIPPLE_UPGRADE_SCRIPT", t "$PLUGINSDIR\ripple-prepare-upgrade.ps1")'
  System::Call 'kernel32::SetEnvironmentVariable(t "RIPPLE_UPGRADE_ROOT", t "$INSTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "RIPPLE_UPGRADE_LANGUAGE", t "$LANGUAGE")'
  ripple_retry:
    nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($$env:RIPPLE_UPGRADE_SCRIPT))) -InstallDirectory $$env:RIPPLE_UPGRADE_ROOT -Language $$env:RIPPLE_UPGRADE_LANGUAGE"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      DetailPrint "$1"
      ${If} ${Silent}
        SetErrorLevel 20
        Quit
      ${EndIf}
      ${If} $LANGUAGE == 2052
        StrCpy $2 "尚未替换文件。$\r$\n$1$\r$\n$\r$\n请先在 Ripple 保存未完成内容并正常退出；如果客户端反复启动连接器，只停用该客户端的 Ripple 连接器，然后重试。取消将保留原安装。"
      ${Else}
        StrCpy $2 "No files have been replaced.$\r$\n$1$\r$\n$\r$\nSave unfinished work in Ripple and exit normally. If a client keeps restarting its adapter, disable only its Ripple connector, then retry. Cancel keeps the existing installation."
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$2" IDRETRY ripple_retry
      SetErrorLevel 20
      Quit
    ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend
!insertmacro RipplePreflight ""
!insertmacro RipplePreflight "un."
!macro NSIS_HOOK_PREUNINSTALL
  Call un.RipplePrepareUpgrade
!macroend
