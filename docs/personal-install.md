# Personal desktop install

The supported product is personal Leash. Install either the signed desktop download for Leash Cloud or run the open-source backend locally.

## Signed desktop build

Download the current macOS or Windows artifact from the Leash website or the matching [Leash GitHub release](https://github.com/open-leash/leash/releases). The release feed verifies platform, architecture, SHA-256, rollout status, and version before offering an update.

The compatibility helper `install-openleash-personal.sh` can install a downloaded macOS DMG:

```bash
./install-openleash-personal.sh --dmg ./Leash-VERSION-arm64.dmg
```

## Personal Open Source

```bash
python3 run.py --mode individual-open-source --clean-slate --yes
```

Docker is used only for Postgres. Built-in Features run directly in Leash Engine and require no Feature images, Docker socket, sandbox pool, or marketplace.

## Uninstall

```bash
python3 run.py --delete-local --yes
```

This stops Leash services, restores managed agent proxy and hook configuration, removes the local Postgres volume, and deletes Leash app state created by the local installation.
