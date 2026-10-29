# Firefox Add-ons listing assets

## Screenshot captions — English (US)

- `firefox-screenshot.png`: Manage blocking, muting, and “Not interested” controls, and view your action counts—all stored locally.
- `firefox-timeline.png`: Block or mute accounts and dismiss unwanted posts directly from your X timeline with one click.

## Release notes — 3.1.4

Added automatic tracking removal when copying X/Twitter post links, including through “Copy link.” Tracking parameters are removed while other URL parameters are preserved.

Fixed action statistics so a failed storage write no longer prevents subsequent updates. Resetting counters now runs through the same queue as action updates to prevent conflicts.

## Notes to reviewer

This extension uses plain JavaScript, HTML, and CSS. No build process, compilation, minification, or external dependencies are required. The submitted files are the executable source code.

`content/clean-url.js` runs in the page’s MAIN world at `document_start` on X/Twitter pages. It intercepts clipboard text writes and copy events to remove known tracking parameters from post URLs. It does not read the system clipboard, transmit data, or require additional permissions.

Settings and action counters are stored locally. The extension does not collect or transmit user data.

To reproduce the extension package from source:

1. Check out tag `v3.1.4` at https://github.com/2-sa/hajb.
2. From the repository root, run:

   ```sh
   zip -r hajb-v3.1.4.zip manifest.json background.js content popup icons _locales
   ```

This packages the source files directly, using the same file selection as the release workflow. Store screenshots and listing text are excluded from the extension package.
