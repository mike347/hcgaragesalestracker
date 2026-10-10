#!/bin/sh
# Daily data refresh. Install as a cron.daily job (no dot in the name, or run-parts skips it):
#   sudo install -m 755 deploy/garage-sales-scrape.sh /etc/cron.daily/garage-sales-update
#
# Runs the scraper as the web user so the files it writes belong to Apache's user.
# The scraper itself runs from the git checkout, which the deploy job keeps current.

OUT_DIR="${OUT_DIR:-/var/www/garagesales}"       # data.js and sales.json are written here
STATE_DIR="${STATE_DIR:-/var/lib/garage-sales}"  # geocode cache lives here (outside the checkout)
SCRIPT="${SCRIPT:-/opt/garage-sales/scrape.mjs}"
NODE="${NODE:-/usr/bin/node}"                    # cron has a minimal PATH, so use the full path (which node)
WEB_USER="${WEB_USER:-www-data}"

exec runuser -u "$WEB_USER" -- env OUT_DIR="$OUT_DIR" STATE_DIR="$STATE_DIR" "$NODE" "$SCRIPT" >> /var/log/garage-scrape.log 2>&1
