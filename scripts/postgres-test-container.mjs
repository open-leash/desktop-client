import { spawn } from "node:child_process";
import process from "node:process";

const POSTGRES_IMAGE = "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";

export async function startIsolatedPostgres(prefix) {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = `${safePrefix}-${process.pid}-${Date.now()}`;
  let started = false;
  try {
    await run("docker", [
      "run", "--detach", "--rm", "--name", name,
      "--publish", "127.0.0.1::5432",
      "--env", "POSTGRES_DB=openleash",
      "--env", "POSTGRES_USER=openleash",
      "--env", "POSTGRES_PASSWORD=openleash",
      POSTGRES_IMAGE,
    ]);
    started = true;

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ready = await run(
        "docker",
        ["exec", name, "psql", "-U", "openleash", "-d", "openleash", "-v", "ON_ERROR_STOP=1", "-c", "select 1"],
        true,
      );
      if (ready.code === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const finalReady = await run(
      "docker",
      ["exec", name, "psql", "-U", "openleash", "-d", "openleash", "-v", "ON_ERROR_STOP=1", "-c", "select 1"],
      true,
    );
    if (finalReady.code !== 0) throw new Error(`Isolated Postgres ${name} did not become ready.`);

    const portResult = await run("docker", ["port", name, "5432/tcp"], true);
    if (portResult.code !== 0) throw new Error(`Could not resolve the host port for ${name}.`);
    const match = portResult.stdout.trim().match(/:(\d+)$/);
    if (!match) throw new Error(`Unexpected Docker port output for ${name}: ${portResult.stdout.trim()}`);

    return {
      databaseUrl: `postgres://openleash:openleash@127.0.0.1:${match[1]}/openleash`,
      name,
      async stop() {
        await run("docker", ["rm", "--force", name], true);
      },
    };
  } catch (error) {
    if (started) await run("docker", ["rm", "--force", name], true);
    throw error;
  }
}

function run(command, args, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${command} ${args.join(" ")} exited ${result.code}: ${stderr.trim()}`));
    });
    child.on("error", reject);
  });
}
