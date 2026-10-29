# Vendored browser assets

These files are served from `/vendor/` so the web terminal does not depend on a
third-party CDN at runtime.

| File | Package | Version |
| --- | --- | --- |
| `xterm.js`, `xterm.css` | `@xterm/xterm` | 5.5.0 |
| `addon-fit.js` | `@xterm/addon-fit` | 0.10.0 |
| `addon-web-links.js` | `@xterm/addon-web-links` | 0.11.0 |

The versions are pinned as devDependencies in `package.json`, and the files are
copied from the installed packages. The npm `lib/` bundles are already the built
UMD distribution, so no build step is involved.

To refresh after a version bump:

```bash
npm install
cp node_modules/@xterm/xterm/lib/xterm.js src/web/vendor/xterm.js
cp node_modules/@xterm/xterm/css/xterm.css src/web/vendor/xterm.css
cp node_modules/@xterm/addon-fit/lib/addon-fit.js src/web/vendor/addon-fit.js
cp node_modules/@xterm/addon-web-links/lib/addon-web-links.js src/web/vendor/addon-web-links.js
cp node_modules/@xterm/xterm/LICENSE src/web/vendor/LICENSE
```

`LICENSE` is the MIT license covering the xterm packages. Do not edit the
vendored files by hand.
