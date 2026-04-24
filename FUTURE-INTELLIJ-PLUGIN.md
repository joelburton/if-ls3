# Future: IntelliJ Plugin

## Goal

A click-to-install IntelliJ plugin on the JetBrains Marketplace, giving
Inform 6 users the same experience as the VS Code extension without manual
TextMate bundle installation or LSP4IJ configuration.

## Architecture

The plugin is a thin wrapper — all the heavy lifting is already done:

- **TextMate grammar** — bundle `inform6.tmbundle` inside the plugin's
  resources and register it programmatically via IntelliJ's TextMate API.
  No manual user setup required.

- **Language server** — bundle `bundled-server/server.cjs` (the esbuild
  bundle) inside the plugin and register it with LSP4IJ's server API so
  it launches automatically for `.inf` / `.h` files.

- **LSP4IJ** — declare as a required plugin dependency in `plugin.xml`.
  The Marketplace installs it alongside the plugin automatically.

The plugin's own code is small: ~100–200 lines of Kotlin plus XML
configuration. No Inform 6 parsing or language logic lives here.

## Node.js dependency

The language server requires Node.js. The right approach is:

- Default to `node` (assumes it's on PATH)
- Expose a single plugin setting: **Path to Node.js executable**
- Fail gracefully with a clear message if Node is not found

Bundling a Node runtime is not worth the ~50 MB plugin size increase.
IntelliJ users are developers and almost certainly have Node installed;
nvm-style installs that aren't on the system PATH are the main edge case
the setting handles.

## Implementation notes

- Build system: IntelliJ Platform Gradle Plugin (the usual Kotlin + Gradle
  setup — expect the normal friction)
- LSP4IJ's API is relatively young and evolving; check current docs at
  plugin development time
- Marketplace plugin signing and submission is a one-time setup step
- The `build-textmate-dist` script already produces the correctly structured
  `inform6.tmbundle`; the Gradle build can invoke it (or replicate the
  copy) to pull the bundle into plugin resources

## When to build

Defer until features are stable enough to publish. The current
TextMate + LSP4IJ manual setup works fine for development and testing.
