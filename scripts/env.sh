# Env for building on machines without system webkit dev headers.
# Uses the user-space extraction at ~/.webkit when present; no-op otherwise
# (CI installs real -dev packages via apt instead).
if [ -d "$HOME/.webkit/usr/lib/x86_64-linux-gnu/pkgconfig" ]; then
  export PKG_CONFIG_PATH="$HOME/.webkit/usr/lib/x86_64-linux-gnu/pkgconfig:$HOME/.webkit/usr/share/pkgconfig"
  export PKG_CONFIG_SYSROOT_DIR="$HOME/.webkit"
fi
