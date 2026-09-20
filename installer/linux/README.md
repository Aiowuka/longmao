# Linux one-click installer

Build:

```bash
./installer/linux/build.sh 0.5.0
```

Output:

```text
installer/linux/output/LongmaoSetup-0.5.0-linux-x64.run
installer/linux/output/LongmaoSetup-0.5.0-linux-x64.run.sha256
```

The self-extracting archive is built with Makeself and contains only the Longmao repository content.

At install time, `scripts/linux/install.sh` downloads the pinned Totoro and WMPFDebugger snapshots directly from their upstream GitHub repositories.

## User install

```bash
chmod +x LongmaoSetup-0.5.0-linux-x64.run
./LongmaoSetup-0.5.0-linux-x64.run
```

## Uninstall

```bash
longmao-uninstall
```

Keep config:

```bash
longmao-uninstall --keep-config
```

The uninstaller removes Longmao-owned files and upstream clones, but intentionally does not remove distro packages such as Git or Redis.
