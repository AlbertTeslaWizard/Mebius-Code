#!/usr/bin/env bash
set -euo pipefail

REPO="AlbertTeslaWizard/Mebius-Code"
VERSION="${MEBIUS_CODE_VERSION:-latest}"
INSTALL_DIR="${MEBIUS_INSTALL_DIR:-$HOME/.local/bin}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  linux) platform="linux" ;;
  darwin) platform="darwin" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) cpu="x64" ;;
  arm64|aarch64) cpu="arm64" ;;
  *) echo "Unsupported CPU: $arch" >&2; exit 1 ;;
esac

if [ "$platform" = "linux" ] && [ "$cpu" != "x64" ]; then
  echo "Linux $cpu binaries are not published yet." >&2
  exit 1
fi

asset="mebius-$platform-$cpu.tar.gz"
case "$VERSION" in
  latest) base_url="https://github.com/$REPO/releases/latest/download" ;;
  v*) base_url="https://github.com/$REPO/releases/download/$VERSION" ;;
  *) base_url="https://github.com/$REPO/releases/download/v$VERSION" ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$base_url/$asset" -o "$tmp_dir/$asset"
curl -fsSL "$base_url/SHA256SUMS" -o "$tmp_dir/SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp_dir" && grep "  $asset$" SHA256SUMS | sha256sum -c -)
else
  expected="$(grep "  $asset$" "$tmp_dir/SHA256SUMS" | awk '{print $1}')"
  actual="$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || { echo "Checksum mismatch for $asset" >&2; exit 1; }
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$tmp_dir/$asset" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/mebius"

echo "Mebius TUI installed to $INSTALL_DIR/mebius"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add this directory to PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

"$INSTALL_DIR/mebius" doctor || true
