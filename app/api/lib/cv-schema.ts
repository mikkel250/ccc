/**
 * Ajv validation against the shipped master/curated CV JSON Schema (KTD3 / R6a).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { getEnvNumber } from "../../../lib/env";

export type CvSchemaValidationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const SCHEMA_RELATIVE = join(
  "references",
  "json-curator",
  "master-cv.schema.json"
);

let validateFn: ValidateFunction | null = null;

function loadValidator(): ValidateFunction {
  if (validateFn) return validateFn;
  const schemaPath = join(process.cwd(), SCHEMA_RELATIVE);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validateFn = ajv.compile(schema);
  return validateFn;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "CV JSON failed schema validation";
  // Client-safe: paths only, no data values (may contain PII).
  const parts = errors.slice(0, 5).map((e) => {
    const path = e.instancePath || "/";
    return `${path} ${e.message ?? "invalid"}`;
  });
  return `CV JSON failed schema validation: ${parts.join("; ")}`;
}

/** Validate unknown JSON against master-cv.schema.json (draft 2020-12). */
export function validateCvJson(data: unknown): CvSchemaValidationResult {
  const validate = loadValidator();
  if (validate(data)) {
    return { ok: true, data };
  }
  return { ok: false, error: formatErrors(validate.errors) };
}

export function getCuratedJsonMaxBytes(): number {
  return Math.max(1, Math.floor(getEnvNumber("TAILOR_CURATED_JSON_MAX_BYTES", 512_000)));
}

export function getTailorResponseMaxBytes(): number {
  return Math.max(1, Math.floor(getEnvNumber("TAILOR_RESPONSE_MAX_BYTES", 2_097_152)));
}

export function getTailorRequestMaxBytes(): number {
  return Math.max(1, Math.floor(getEnvNumber("TAILOR_REQUEST_MAX_BYTES", 65_536)));
}

export function getTailorJdMaxChars(): number {
  return Math.max(1, Math.floor(getEnvNumber("TAILOR_JD_MAX_CHARS", 50_000)));
}

/** Reject oversize serialized curated JSON before render/return (R6b). */
export function assertCuratedJsonSize(
  curated: unknown
): { ok: true } | { ok: false; error: string } {
  const serialized = JSON.stringify(curated);
  const max = getCuratedJsonMaxBytes();
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > max) {
    return { ok: false, error: "Curated CV exceeds configured size limit" };
  }
  return { ok: true };
}
