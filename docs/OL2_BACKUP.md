# OL2 Private Backup

Use this for occasional disaster-recovery backups of the whole OL2 workspace:

```bash
npm run backup:ol2
```

The script:

- asks for a password,
- archives the OL2 folder,
- includes `.env` files, cloud wrapper repos, and nested app `.git` directories,
- excludes reinstallable/generated files such as `node_modules`, `.next`, `dist`, `build`, Flutter/Gradle caches, app bundles, installers, and logs,
- encrypts the archive with OpenSSL,
- splits it into GitHub-safe chunks below GitHub's 50MB warning threshold,
- commits it into `../ol2-backup`,
- pushes to the private GitHub repo `mnns/ol2-backup`.

By default the backup repo is a rolling latest snapshot. That keeps GitHub from
growing forever with multi-GB backup history. Use this only when you explicitly
want every backup retained in Git history:

```bash
npm run backup:ol2 -- --keep-history
```

Restore:

```bash
git clone https://github.com/mnns/ol2-backup.git
cd ol2-backup
python3 restore_ol2_backup.py --target ../OL2-restored
```

The restored folder contains the nested app Git repos as they existed when the
backup was made. After restore, reinstall generated dependencies normally:

```bash
cd ../OL2-restored/OL2
npm install
```

To include generated dependency/build output anyway:

```bash
npm run backup:ol2 -- --include-generated
```
