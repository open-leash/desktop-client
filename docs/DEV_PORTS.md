# Leash Local Development Ports

Leash local development uses fixed 9000-range ports. Do not assign random ports in local runners or package defaults.

| Service | Port | URL |
| --- | ---: | --- |
| Desktop local API | 9317 | `http://127.0.0.1:9317` |
| Client API | 9318 | `http://localhost:9318` |
| Dashboard API | 9319 | `http://localhost:9319` |
| Dashboard Web, default/private cloud | 9301 | `http://localhost:9301` |
| Cloud Dashboard Web | 9302 | `http://localhost:9302` |
| Main Web | 9305 | `http://localhost:9305` |
| Docs Web | 9306 | `http://localhost:9306` |
| Postgres host binding | 9543 | `postgres://openleash:openleash@localhost:9543/openleash` |

Postgres still listens on `5432` inside Docker networks, for example `postgres://openleash:openleash@postgres:5432/openleash`.
