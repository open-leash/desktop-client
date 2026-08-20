# Feature Island contributions

Built-in Features may publish typed, bounded, expiring annotations and status through the Island capability. Leash owns layout, animation, accessibility, scope filtering, and navigation; Features never send UI code.

The host validates each contribution, requires `island:publish`, caps text and progress, binds it to the authenticated personal user and exact agent session, and expires stale state. Features may clear their own contribution but cannot affect another Feature.

Feature handlers execute in-process and use the same capability interface as evaluation handlers. They do not receive Electron IPC, arbitrary HTML/CSS/JavaScript, shell access, database credentials, provider keys, or a Docker socket.
