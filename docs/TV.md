# TV deployment boundaries

## Normal development app

`app/dist/` has app ID `org.orca.c2home`. Package it with `npm run package`. Install through your configured webOS development environment, then launch and verify on the physical TV. No host address, SSH key, or pairing state is included in this project. The reusable pairing broker is a library only; a device-specific live controller is deliberately not published.

The app's advanced settings allow app-ID overrides. Default launch candidates are Moonfin (`org.moonfin.webos`), Moonlight (`com.limelight.webos`), YouTube (`youtube.leanback.v4`), and HDMI 1/2. Candidate IDs are not proof that the app exists on another TV.

## System Home variant

`python3 app/build_home_variant.py` copies a built launcher into `app/homeapp/` with ID `com.webos.app.home` and privileged permissions. Creating these files does not replace Home or grant permissions by itself. Installing a development app and replacing system Home are separate operations.

On the original rooted installation, no-flash Home used a bind mount over the system Home directory, an application-manager re-read, and a boot hook. Those privileged, firmware-specific scripts, exploit assets, device backups, and access keys are **not** distributed here. Do not overwrite system Home based only on this description. Establish and test a recovery path first; do not modify kernel, boot partitions, or rootfs.

For an already-authorized deployment, preserve the installed application's owner/mode, read back hashes of the exact target files, then reload the running webview. A successful file copy does not prove that the webview is running the new code. A launch service returning success does not prove foreground visibility.

## Validation checklist

- Physical remote: directions, OK, Back, Home, and app exit; no unwanted stock-Home flash.
- Each tile launches the intended visible app; HDMI inputs work with the actual external device/controller.
- Weather restores after restart and sign-out clears the saved Moonfin server session.
- The merged shelf respects progress/next-up and never exceeds three cards.
- Patched Moonfin opens the exact card from cold start and while already running.
- PC theme changes arrive through SSE; leaving Home closes the stream; return reconnects.
- Disconnecting the PC keeps the running page usable and reconnects without user action.

Long Home is currently the TV's stock magnifier on the tested Home replacement. Restoring stock LG Home on long press remains optional/unimplemented. HDMI 2 needs a real external-controller end-to-end validation; simulated CDP keys are not sufficient proof.
