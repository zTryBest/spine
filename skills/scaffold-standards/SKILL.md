---
name: scaffold-standards
description: Build and use company scaffold standards from generated scaffold code and online scaffold documentation. Use when Codex must analyze a completed scaffold, crawl scaffold docs with Playwright, summarize directory responsibilities, decide which dependencies to add for business scenarios, or enforce company scaffold conventions during implementation.
---

# Scaffold Standards

Use this skill to turn a generated project scaffold and its online documentation into reusable implementation rules. Keep upstream workflow skills unchanged; place company-specific scaffold knowledge in this skill's references or in the target repository's docs.

## Workflow

1. Confirm the scaffold has already been generated.
2. Inspect the generated repository before reading external docs:
   - list top-level directories and important config files;
   - identify framework, package manager, build tools, routing style, test tools, lint tools, and UI library;
   - search existing examples before creating any new pattern.
3. If scaffold documentation has not been summarized yet, crawl it with `scripts/crawl_scaffold_docs.mjs`.
4. Summarize the crawl output into the reference templates:
   - `references/scaffold-doc-summary.md`
   - `references/directory-responsibilities.md`
   - `references/dependency-decision-rules.md`
   - `references/implementation-playbook.md`
5. During implementation, load only the references relevant to the current task.
6. Before finishing, verify that new files live in the expected directories and dependencies follow the decision rules.

## First-Time Documentation Capture

When the user provides an online scaffold documentation URL, use Playwright to capture it before writing scaffold rules:

```bash
node path/to/scaffold-standards/scripts/crawl_scaffold_docs.mjs --url "https://example.com/docs" --out work/scaffold-docs
```

If the docs require login, SSO, a local VPN, or manual navigation, open the page with Playwright/browser tooling and ask the user only for the missing access step. Do not infer private documentation from memory.

Read the generated `summary.json`, `pages/*.md`, and `links.txt`; then update the reference templates with concrete rules. Preserve URLs and section titles so future agents can trace every rule back to source material.

## Directory Analysis Rules

When analyzing the scaffold, classify every important directory with:

- purpose: what module or concern belongs here;
- allowed contents: file types, modules, and naming conventions;
- forbidden contents: code that should move elsewhere;
- import direction: what this directory may import from;
- examples: existing files from the generated scaffold;
- creation rule: when to add a new file here.

Use `references/directory-responsibilities.md` as the durable output format.

## Dependency Decision Rules

When the user asks for a business feature, decide dependencies from business capability, not package popularity.

For each dependency class, record:

- trigger: which business scenario requires it;
- preferred package: company-approved library or internal package;
- install command: package-manager-specific command;
- integration location: config/module/provider/component entry point;
- alternatives: allowed fallback packages;
- avoid: packages or patterns that conflict with the scaffold;
- verification: tests, lint checks, build checks, or manual smoke checks.

Use `references/dependency-decision-rules.md` as the durable output format.

## Implementation Behavior

Before coding:

1. Read `references/scaffold-doc-summary.md` if the task relies on scaffold-specific behavior.
2. Read `references/directory-responsibilities.md` before adding or moving files.
3. Read `references/dependency-decision-rules.md` before installing dependencies.
4. Read `references/implementation-playbook.md` for conventions about routing, state, API calls, forms, permissions, UI, testing, and deployment.
5. Search the current repository for equivalent examples and follow the closest local pattern.

While coding:

- prefer scaffold-provided commands, helpers, generators, aliases, and UI components;
- do not introduce new framework layers when the scaffold already has a path for the concern;
- keep business code near the feature boundary unless the directory rules require shared placement;
- add dependencies only when the decision rules say the business scenario needs them;
- update the scaffold references when implementation reveals a missing rule.

Before final response:

- run the project's available build, typecheck, lint, and focused tests when practical;
- report any dependency added and the rule that justified it;
- report any new directory or module type introduced.

## Reference Files

- `references/scaffold-doc-summary.md`: fill after crawling online docs; load when docs-derived scaffold behavior matters.
- `references/directory-responsibilities.md`: fill after analyzing generated scaffold; load before adding files.
- `references/dependency-decision-rules.md`: fill before installing new dependencies; load for feature planning and implementation.
- `references/implementation-playbook.md`: fill with company/scaffold coding conventions; load before substantial coding.

If a reference is still a template, complete the relevant section from the current scaffold and documentation before relying on it.
