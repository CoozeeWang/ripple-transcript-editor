; Production-only declaration; Dev never claims this URL scheme.
!define RIPPLE_SEGMENT_SCHEME "ripple-transcript"
!macro RippleRegisterSegmentLink
  !if "${BUNDLEID}" == "studio.ripple.app"
    WriteRegStr SHCTX "Software\Classes\${RIPPLE_SEGMENT_SCHEME}" "" "URL:Ripple transcript"
    WriteRegStr SHCTX "Software\Classes\${RIPPLE_SEGMENT_SCHEME}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\${RIPPLE_SEGMENT_SCHEME}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  !endif
!macroend
!macro RippleUnregisterSegmentLink
  !if "${BUNDLEID}" == "studio.ripple.app"
    ReadRegStr $R7 SHCTX "Software\Classes\${RIPPLE_SEGMENT_SCHEME}\shell\open\command" ""
    ${If} $R7 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
      DeleteRegKey SHCTX "Software\Classes\${RIPPLE_SEGMENT_SCHEME}"
    ${EndIf}
  !endif
!macroend
