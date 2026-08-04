# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Rust support** (`.rs`). Detects free functions and `impl`/trait methods,
  including generics and lifetimes. `match` arms are counted as branches, the
  `?` try operator is not treated as a decision, and lifetimes (`'a`) and loop
  labels (`'outer:`) are distinguished from char literals so they don't corrupt
  the scan.
- **Cognitive complexity** metric (SonarSource) reported alongside cyclomatic
  complexity, so a flat-but-boolean-heavy function can be told apart from a
  genuinely tangled, deeply-nested one.
- **Git churn × complexity risk ranking.** When run inside a git repository,
  functions are ranked by a `complexity × churn` risk score to surface hotspots
  that are both hard to change and changed often. On by default; use
  `--no-churn` to skip and `--since` to bound the window.
- **Markdown report output** via `--markdown`, for dropping results into pull
  requests, issues, and CI comments.

### Changed

- The CLI `--version` now reads directly from `package.json`.

## [0.1.0]

### Added

- Initial release: zero-dependency complexity & tech-debt dashboard that walks a
  codebase, scores every function for cyclomatic complexity, and writes a
  self-contained HTML report of hot spots per file and function.
- Support for JavaScript, TypeScript, Python, Go, Java, and C#.
