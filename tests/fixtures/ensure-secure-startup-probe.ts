/**
 * Spawned by tests/tailor-auth.test.ts to assert process.exit in a child
 * whose NODE_ENV is not "test" (the in-process suite skips that branch).
 */
import { ensureSecureStartup } from "../../app/api/lib/tailor-auth";

ensureSecureStartup();
