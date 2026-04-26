Pre-built binaries for the Inform 6 compiler used by the language server.
Download the binary for your platform, place it somewhere convenient, and
point `compiler` in your `inform6rc.yaml` at it.

---

## Windows

Download **`inform6-windows-x64.exe`**, rename it to `inform6.exe`, and place
it somewhere on your PATH (e.g. `C:\Users\you\bin\inform6.exe`).

No signing or extra setup required — just download and run.

---

## macOS

macOS **Gatekeeper blocks unsigned binaries** downloaded from the internet.
You have two options:

**Option A — remove the quarantine flag (quick):**

```
chmod +x inform6-macos-arm64     # or inform6-macos-x64 for Intel Macs
xattr -d com.apple.quarantine inform6-macos-arm64
```

Move the binary somewhere on your PATH, e.g. `~/bin/inform6`.

> Use `inform6-macos-arm64` on Apple Silicon (M1/M2/M3/M4) Macs and
> `inform6-macos-x64` on older Intel Macs. If you're not sure, check
> **Apple menu → About This Mac**: look for "Apple M" (ARM) or "Intel" in
> the chip/processor line.

**Option B — compile from source (avoids quarantine entirely):**

```bash
git clone https://github.com/joelburton/if-ls3.git
make -C if-ls3/Inform6
cp if-ls3/Inform6/inform6 ~/bin/
```

Requires Xcode Command Line Tools (`xcode-select --install` if not installed).
Takes about 10 seconds.

---

## Linux

```bash
chmod +x inform6-linux-x64
mv inform6-linux-x64 ~/bin/inform6
```

---

## Configuring the language server

Add to your workspace's `inform6rc.yaml`:

```yaml
compiler: ~/bin/inform6    # adjust to wherever you placed the binary
libraryPath: ~/if/inform6lib
```

See the [extension README](https://github.com/joelburton/if-ls3/blob/main/langserver/README.md)
for the full `inform6rc.yaml` reference.
