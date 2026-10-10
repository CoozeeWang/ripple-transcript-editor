#!/bin/zsh
set -eu
project_dir="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
exec node "$project_dir/scripts/desktop-dev.mjs"
