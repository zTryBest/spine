# Hikspine Workflow Rules

These project rules are distributed from the Hikspine plugin into `.claude/rules`.

- Treat `/hs` as a natural-language trigger for the `hikspine` skill, not as a slash-command file.
- Drive Hikspine with two verbs only: `next` (show the current state's missing decisions and composable skills) and `decide <key> <value>` (record a decision).
- When selecting a workflow, first check whether the project already has source code (e.g. `git ls-files`); do not assume it is empty. Choose `new` only for an essentially empty/fresh repo — if source code already exists, choose `feature` or `fix`, never `new`.
- The only thing that advances the workflow is `decide`. `next` reads decisions, not files; calling `next` alone never moves forward.
- After finishing a state's work, record every decision in its `needs` with `decide`. Do not stop and ask the user "should I move to the next phase?" after producing artifacts unless the state is `requiresUser: true`.
- Compose skills from the state's `capabilities`; do not replace a skill that clearly applies with a handwritten approximation.
- Read the state's `rules` (workflow-authored) and honor each as a hard requirement for that state — e.g. a workflow may mandate a specific skill. The engine passes `rules` through but does not enforce them; honoring them is your responsibility.
- Phase transitions are governed by the workflow, not by composed skills. A composed skill's offer to proceed or question about next steps is its own boundary, not a workflow stop — record the state's `needs` with `decide` and call `next`. The only real stop is `requiresUser`.
- For valued decisions pass the real result (`review_result pass`, `verify_result fail`). A `fail` triggers a cross-state rollback that clears downstream decisions, forcing the work to be redone.
- When `requiresUser: true`, stop and ask the user before recording the confirming decision (`design_confirmed`, `archived`). Never confirm on the user's behalf.
- Do not write source files while the current state's guard forbids `write-source`.
- Match the user's current workflow language for explanations, questions, summaries, and workflow artifacts unless the user explicitly requests another language or the project artifact convention clearly differs.

## 决策点规则
当遇到需要人工确认的时候，请使用`AskQuestion`的方式询问用户，不要让用户一次性回答批量问题。

## 技术栈
前后端编码目录需要分离，根据组件标识，前端编码目录为组件标识-front,后端编码目录则命名即为组件标识。
后端脚手架提供两个选择给用户 ： `Areis` `Startfish`
