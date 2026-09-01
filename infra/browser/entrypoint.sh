#!/bin/sh
set -eu

mkdir -p /data/chromium
chown -R browser:browser /data/chromium

exec gosu browser /usr/bin/supervisord -n -c /etc/supervisor/conf.d/threadbeacon-browser.conf
