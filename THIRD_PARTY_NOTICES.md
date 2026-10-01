# Third-party notices

## JSZip

- Package: JSZip 3.10.1
- Source: npm package `jszip@3.10.1`
- License: MIT / GPLv3 dual-license as distributed by the project
- Bundled file: `PromptSave/vendor/jszip.min.js`
- Bundled license text: `PromptSave/vendor/JSZip-LICENSE.markdown`

The bundled minified file has one local compatibility hardening change: the legacy `setImmediate` shim no longer compiles string callbacks with `new Function`; non-function callbacks are rejected instead. Normal JSZip use passes function callbacks, so ZIP behavior is unchanged while MV3 avoids dynamic code compilation.

JSZip is bundled locally and is loaded only when ZIP import/export is used. The extension does not load executable code from a remote server.

## Reference repositories reviewed during design

### obtahir/PromptShelf

Repository reviewed at commit `a462d50`. Its right-click capture flow and success-badge interaction were used as behavioral references. This implementation does not copy its storage model, title prompt flow, or input-escaping approach, and no PromptShelf source file is copied into this project.

### Merserk/Prompt-Holder

Repository reviewed at commit `0c555a0`, licensed AGPL-3.0. Its category/edit/recycle-bin behavior and side-panel/dashboard organization were reviewed as product references. This implementation was written independently rather than copying AGPL source code, so the extension is not distributed as a modified copy of Prompt-Holder. The original repository and its AGPL-3.0 `LICENSE` remain intact in the adjacent reference checkout.
