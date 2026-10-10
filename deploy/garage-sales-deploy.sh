#!/bin/sh
# Pull the latest version from GitHub and publish the page to the web folder.
#
# Install ONCE as a root-owned copy (it is deliberately not run from the git checkout, so root never
# executes code that arrived from GitHub):
#   sudo install -m 755 deploy/garage-sales-deploy.sh /usr/local/bin/garage-sales-deploy
#
# Only GarageSalesTracker.html is copied into the web folder. data.js (written by the scraper) is never
# touched, so a deploy can't wipe the data. Prints a line only when something changed (or on error).

set -eu

REPO_DIR="${REPO_DIR:-/opt/garage-sales}"        # git checkout, outside the web root
WEB_DIR="${WEB_DIR:-/var/www/garagesales}"       # folder Apache serves for the tracker
BRANCH="${BRANCH:-main}"
WEB_USER="${WEB_USER:-www-data}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Wrapped in a function so the shell has read the whole script before anything runs.
main() {
  cd "$REPO_DIR"

  git fetch --quiet origin "$BRANCH"
  old=$(git rev-parse HEAD)
  new=$(git rev-parse "origin/$BRANCH")
  if [ "$old" != "$new" ]; then
    git reset --hard --quiet "origin/$BRANCH"
    log "updated checkout $(echo "$old" | cut -c1-7) -> $(echo "$new" | cut -c1-7)"
  fi

  # Publish only when the file differs, so its modified time (and browser caching) stays stable.
  if ! cmp -s GarageSalesTracker.html "$WEB_DIR/GarageSalesTracker.html"; then
    install -m 644 -o "$WEB_USER" -g "$WEB_USER" GarageSalesTracker.html "$WEB_DIR/GarageSalesTracker.html"
    log "published GarageSalesTracker.html to $WEB_DIR"
  fi
}

main "$@"
exit $?
