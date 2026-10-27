-- Finder persists these view settings in the mounted image's .DS_Store.
on run argv
    set diskName to item 1 of argv
    tell application "Finder"
        tell disk (diskName as string)
            open
            tell container window
                set current view to icon view
                set toolbar visible to false
                set statusbar visible to false
                set bounds to {120, 120, 780, 560}
            end tell
            set viewOptions to icon view options of container window
            tell viewOptions
                set arrangement to not arranged
                set icon size to 112
                set text size to 14
            end tell
            set background picture of viewOptions to file ".background:Install.png"
            set position of item "Ripple.app" to {170, 190}
            set position of item "Applications" to {490, 190}
            close
            open
            delay 1
            tell container window to set bounds to {120, 120, 770, 550}
            delay 1
            tell container window to set bounds to {120, 120, 780, 560}
            delay 3
        end tell
    end tell
end run
