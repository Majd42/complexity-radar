import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A configuration file lets a project commit its scan settings — ignore globs,
 * thresholds, output paths — instead of repeating CLI flags in every CI job.
 *
 * Every field mirrors a CLI flag. Values here are the *defaults*; anything
 * passed on the command line overrides them (except `ignore`, whose CLI globs
 * are appended to the config's). Path-like values (`paths`, `output`, `json`,
 * `markdown`, `baseline`) are resolved relative to the config file's own
 * directory, so a config found by walking up the tree still points at the right
 * files no matter which sub-directory you run from.
 */
export interface FileConfig {
  paths?: string[];
  output?: string;
  json?: string | null;
  markdown?: string | null;
  threshold?: number | null;
  top?: number;
  ignore?: string[];
  quiet?: boolean;
  churn?: boolean;
  since?: string | null;
  baseline?: string | null;
  failOnRegression?: boolean;
}

/** A loaded config plus where it came from (for path resolution and logging). */
export interface LoadedConfig {
  /** The validated configuration. */
  config: FileConfig;
  /** Absolute path to the file the config was read from. */
  path: string;
  /** Directory containing the config file — the base for relative paths. */
  dir: string;
}

/** Config file names searched for, in priority order, within each directory. */
export const CONFIG_FILENAMES = ["complexity-radar.json", ".complexity-radar.json"];

/** Key under which `package.json` may embed a config, as a last resort. */
const PACKAGE_JSON_KEY = "complexity-radar";

/**
 * Load a configuration file.
 *
 * With an explicit `configPath`, that file must exist and parse or an error is
 * thrown. Otherwise the search walks up from `cwd` to the filesystem root,
 * returning the first `complexity-radar.json`, `.complexity-radar.json`, or
 * `package.json` (`"complexity-radar"` key) it finds — or `null` if none exist.
 */
export function loadConfig(cwd: string, configPath?: string | null): LoadedConfig | null {
  if (configPath) {
    const path = resolve(cwd, configPath);
    if (!existsSync(path)) {
      throw new Error(`config file not found: ${configPath}`);
    }
    return { config: readConfigFile(path), path, dir: dirname(path) };
  }
  return discoverConfig(cwd);
}

/** Walk up from `cwd` looking for a config file; return the nearest one. */
function discoverConfig(cwd: string): LoadedConfig | null {
  let dir = resolve(cwd);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const path = resolve(dir, name);
      if (existsSync(path)) {
        return { config: readConfigFile(path), path, dir };
      }
    }
    const pkgConfig = readPackageJsonConfig(resolve(dir, "package.json"));
    if (pkgConfig) return { config: pkgConfig, path: resolve(dir, "package.json"), dir };

    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/** Read a file as UTF-8, stripping a leading byte-order mark if present. */
function readText(path: string): string {
  const text = readFileSync(path, "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse and validate a standalone JSON config file. */
function readConfigFile(path: string): FileConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readText(path));
  } catch (err) {
    throw new Error(`could not parse config "${path}": ${(err as Error).message}`);
  }
  return validateConfig(raw, path);
}

/** Read a `"complexity-radar"` block from a package.json, if present and an object. */
function readPackageJsonConfig(path: string): FileConfig | null {
  if (!existsSync(path)) return null;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readText(path)) as Record<string, unknown>;
  } catch {
    return null; // a malformed package.json is not our concern; keep searching
  }
  const block = pkg[PACKAGE_JSON_KEY];
  if (block === undefined) return null;
  return validateConfig(block, `${path} (${PACKAGE_JSON_KEY})`);
}

/** Fields the config accepts, with the type each must have when present. */
const FIELD_TYPES: Record<keyof FileConfig, "string" | "number" | "boolean" | "string[]"> = {
  paths: "string[]",
  output: "string",
  json: "string",
  markdown: "string",
  threshold: "number",
  top: "number",
  ignore: "string[]",
  quiet: "boolean",
  churn: "boolean",
  since: "string",
  baseline: "string",
  failOnRegression: "boolean",
};

/** Nullable fields may also be `null`, read as "leave unset". */
const NULLABLE = new Set<keyof FileConfig>(["json", "markdown", "threshold", "since", "baseline"]);

/**
 * Validate untrusted JSON into a {@link FileConfig}. Unknown keys warn (to catch
 * typos like `thresholds`) but don't fail; wrong-typed known keys throw with a
 * message naming the source, so a bad config fails loudly instead of silently
 * doing the wrong thing.
 */
export function validateConfig(raw: unknown, source: string): FileConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config "${source}" must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  const out: FileConfig = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "$schema") continue; // allow an editor-schema pointer
    const expected = FIELD_TYPES[key as keyof FileConfig];
    if (!expected) {
      process.stderr.write(`warning: unknown config key "${key}" in ${source} (ignored)\n`);
      continue;
    }
    if (value === null && NULLABLE.has(key as keyof FileConfig)) continue; // unset
    if (!hasType(value, expected)) {
      throw new Error(`config "${source}": "${key}" must be ${expected}, got ${describe(value)}`);
    }
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function hasType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string[]": return Array.isArray(value) && value.every((v) => typeof v === "string");
    default: return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
