# Hikspine Workflow Rules

These project rules are distributed from the Hikspine plugin into `.claude/rules`.

- Treat `/hs` as a natural-language trigger for the `hikspine` skill, not as a slash-command file.
- Use `next` as the only Hikspine workflow protocol.
- Read `requiredInputs` before running the skill named by `nextSkill`, especially when `useBefore` names that skill.
- If `nextSkill` is present, immediately load and use that skill before doing manual work for the node.
- Use every `requiredSkills` entry before considering the current node complete; do not replace required skill execution with a handwritten approximation.
- Produce the files declared in `outputs` and satisfy the machine-checkable `missing` items before moving on.
- When a node has `agent.requiresUser: true`, stop and ask the user before writing the confirmation artifact. Do not fabricate user confirmation.
- When `agent.requiredQuestions` is present, ask or explicitly confirm each listed decision topic with the user, including technology stack decisions.
- Do not rely on self-reported semantic completion. Hikspine advances when observable `exit.checks` pass.
- Do not write source files while the current phase guard forbids `write-source`.
- Match the user's current workflow language for explanations, questions, summaries, and workflow artifacts unless the user explicitly requests another language or the project artifact convention clearly differs.

## 决策点规则
当遇到需要人工确认的时候，请使用`AskQuestion`的方式询问用户，不要让用户一次性回答批量问题。

## 技术栈
前后端编码目录需要分离，根据组件标识，前端编码目录为组件标识-front,后端编码目录则命名即为组件标识。
后端脚手架提供两个选择给用户 ： `Areis` `Startfish`
