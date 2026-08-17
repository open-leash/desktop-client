# Leash release system

The canonical release path is the deterministic production pipeline:

```bash
python3 release.py

# Equivalent automation-friendly commands:
python3 release.py --production --app desktop-client=0.37.6 --dry-run --yes
python3 release.py --production --app desktop-client=0.37.6 --ship --yes
```

It does not use an LLM. The selected components, versions, dependency order,
commands, migration policy, publication workflows, and live checks are encoded
in source and covered by tests. See [`docs/RELEASING.md`](docs/RELEASING.md).

Never publish manually around a failed gate. Resume the recorded state after
fixing the failure:

```bash
python3 release.py --production --resume ~/.openleash-release/production-TIMESTAMP.json --ship --yes
```
