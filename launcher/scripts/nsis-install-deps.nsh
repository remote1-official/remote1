; REMOTE1 Launcher - Install dependencies after main install
; Moonlight Game Streaming Client is bundled in resources/

!macro customInstall
  ; Check if Moonlight is already installed
  IfFileExists "$PROGRAMFILES\Moonlight Game Streaming\Moonlight.exe" moonlight_done
  IfFileExists "$PROGRAMFILES64\Moonlight Game Streaming\Moonlight.exe" moonlight_done
  IfFileExists "$LOCALAPPDATA\Moonlight Game Streaming\Moonlight.exe" moonlight_done

  ; Install Moonlight silently
  DetailPrint "Installing Moonlight Game Streaming..."
  IfFileExists "$INSTDIR\resources\resources\MoonlightSetup.exe" 0 moonlight_done
    ExecWait '"$INSTDIR\resources\resources\MoonlightSetup.exe" /S' $0
    DetailPrint "Moonlight install exit code: $0"

  moonlight_done:
!macroend
