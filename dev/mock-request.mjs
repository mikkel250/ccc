/**
 * @param {unknown} error
 * @param {import("node:http").ServerResponse} res
 */
function isClientDisconnect(error, res) {
  const code =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  const message = error instanceof Error ? error.message : "";
  return (
    code === "ECONNRESET" ||
    message === "aborted" ||
    res.writableEnded ||
    res.destroyed
  );
}

/**
 * Run a mock handler without letting a disconnected client reject the process.
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} handle
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export function guardMockRequest(handle, req, res) {
  Promise.resolve()
    .then(() => handle(req, res))
    .catch((error) => {
      if (isClientDisconnect(error, res)) return;
      try {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end();
        }
      } catch {
        // The socket closed between the check and the write.
      }
    });
}
