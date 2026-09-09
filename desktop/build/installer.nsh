; ResumeAI Pro — custom NSIS steps for electron-builder.
; Firewall: allow the app executable to accept inbound connections so the
; optional LAN mode (other desktops browsing http://<host>:34567) works out
; of the box. Rule is keyed by name for clean removal at uninstall.

!macro customInstall
  DetailPrint "Adding Windows Firewall rule for ResumeAI Pro..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="ResumeAI Pro" dir=in action=allow enable=yes profile=any program="$INSTDIR\ResumeAI Pro.exe"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule for ResumeAI Pro..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="ResumeAI Pro"'
!macroend
