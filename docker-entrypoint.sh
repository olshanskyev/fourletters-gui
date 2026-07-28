#!/bin/sh
set -e

# Toggle HTTP-only vs HTTPS blocks in the nginx config based on whether a cert path is given.
if [ -f /etc/nginx/conf.d/default.conf ]; then
  if [ -z "$CERT_PATH" ]; then
    echo "No CERT_PATH provided. Configuring Nginx for HTTP only."
    sed -i '/# HTTPS_REDIRECT_START/,/# HTTPS_REDIRECT_END/d' /etc/nginx/conf.d/default.conf
    sed -i '/# HTTPS_SERVER_START/,/# HTTPS_SERVER_END/d' /etc/nginx/conf.d/default.conf
  else
    echo "CERT_PATH provided. Configuring Nginx for HTTPS."
    sed -i '/# HTTP_ONLY_START/,/# HTTP_ONLY_END/d' /etc/nginx/conf.d/default.conf
  fi
fi

# Replace placeholders of the form __VAR__ in the built app and nginx config.
# List the variable names (space separated) in SUBSTITUTE_VARS.
if [ -n "$SUBSTITUTE_VARS" ]; then
  for var in $SUBSTITUTE_VARS; do
    val=$(printenv "$var")
    if [ -n "$val" ]; then
      echo "Replacing __${var}__ in /usr/share/nginx/html"
      find /usr/share/nginx/html -type f -exec sed -i "s|__${var}__|${val}|g" {} +

      if [ -f /etc/nginx/conf.d/default.conf ]; then
        echo "Replacing __${var}__ in nginx config"
        sed -i "s|__${var}__|${val}|g" /etc/nginx/conf.d/default.conf
      fi
    fi
  done
fi

nginx -g 'daemon off;'
