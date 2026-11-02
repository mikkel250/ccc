import http from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listenDeepseekMock } from "../dev/deepseek-mock.mjs";

describe("listenDeepseekMock", () => {
  it("keeps serving after a client aborts a POST", async () => {
    const { server } = listenDeepseekMock({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once("listening", () => {
        const address = server.address();
        if (address && typeof address === "object") resolve(address.port);
      });
    });
    const rejections: unknown[] = [];
    const onRejection = (error: unknown) => {
      rejections.push(error);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const abortSocketClosed = new Promise<void>((resolve) => {
        server.once("connection", (socket) => {
          socket.once("close", () => resolve());
        });
      });
      await new Promise<void>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: "/chat/completions",
          headers: { "content-type": "application/json", "content-length": "100000" },
        });
        req.on("error", () => resolve());
        req.write("partial", () => {
          req.destroy();
        });
      });
      await abortSocketClosed;
      const status = await new Promise<number | string>((resolve) => {
        const req = http.get({ hostname: "127.0.0.1", port, path: "/health" }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", (error) =>
          resolve("code" in error && typeof error.code === "string" ? error.code : "down")
        );
      });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      assert.deepEqual(rejections, []);
      assert.equal(status, 200);
    } finally {
      process.off("unhandledRejection", onRejection);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
