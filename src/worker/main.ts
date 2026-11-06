/**
 * Background worker entry point (`npm run worker`). Runs job handlers and recurring schedules from
 * the PostgreSQL job table; any number of worker processes can run side by side.
 *
 * The environment is loaded before the worker module is imported, because the database client is
 * created when its module first loads.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file: the environment is provided by the container or the shell.
}

import("./run")
  .then(({ runWorker }) => runWorker())
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        time: new Date().toISOString(),
        level: "error",
        component: "worker",
        message: "Worker failed to start",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });

export {};
