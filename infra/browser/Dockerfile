FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_GEOMETRY=1440x900x24

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      chromium-sandbox \
      curl \
      fluxbox \
      fonts-noto-cjk \
      gosu \
      novnc \
      supervisor \
      websockify \
      x11vnc \
      xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin browser \
    && mkdir -p /data/chromium \
    && chown -R browser:browser /data /home/browser

COPY supervisord.conf /etc/supervisor/conf.d/threadbeacon-browser.conf
COPY entrypoint.sh /usr/local/bin/threadbeacon-browser-entrypoint

VOLUME ["/data/chromium"]
EXPOSE 6080 9222

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:9222/json/version >/dev/null \
    && curl --fail --silent http://127.0.0.1:6080/vnc.html >/dev/null || exit 1

ENTRYPOINT ["/bin/sh", "/usr/local/bin/threadbeacon-browser-entrypoint"]
