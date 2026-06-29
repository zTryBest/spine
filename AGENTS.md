## 脚本规范
脚本都采用node技术栈，可跨平台兼容

## 脚本依赖关系


新增共享工具函数时（如 hash、yaml 解析），如果两个脚本都需要，允许在各自脚本中独立实现，不强制抽共享文件。


## 双语言 Skill

skill 优化时先写中文版本（`assets/skills-zh/`），用户确认后再修改英文版本（`assets/skills/`）。

## 中文术语翻译规范

中文文档不得把英文 “gate” 直译为“门”（如“压缩门”“调试门”“确认门”），这种译法在中文语境下不自然。应按实际含义翻译：

- `gate`（阶段性检查/阻塞点）→ 根据语境用“协议”“阶段”“检查”“阻塞点”等，如 `debug gate` → “异常调试协议”
- 修饰词性质的 `proactive/active` → “主动式”，如 `proactive context compression` → “主动式上下文压缩”，不写作“主动压缩门”
- 英文版保持原术语（如 Debug Gate），仅中文版需要遵循本规范

## Skill 触发表述规范

修改 skill 时，新增或调整依赖 skill 的触发方式必须和既有写法保持一致：

- 中文统一使用：`**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`
- 英文统一使用：`**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`
- 后续输入、上下文或执行要求写在“技能加载后 / After the skill loads”段落，不要把 `ARGUMENTS`、`fast-forward` 等另一套调用术语混入触发句。

## Changelog 规范

每次代码产生变更你都应该在完成后写Changelog，并确定是否需要升级版本号，版本号只会比master分支的版本号大一个版本，你需要确定一下当前master的版本号后做决定

如果当前已经有了一个比master大的版本Changelog，则应该追加到同一个版本的Changelog条目下

如果修改的是Skill内容，则需要等中英文完全同步之后再写Changelog

文件：`CHANGELOG.md`，新版本条目置顶。

```
## What's Changed [x.y.z] - YYYY-MM-DD

### Added / Changed / Fixed / Tests / Removed / Security

- **功能名**: 描述做了什么以及为什么
```

要点：
- 版本号与 `package.json` 的 `version` 字段一致
- 每条以 `- **粗体关键词**: ` 开头，后接具体变更内容
- 按类型分组：Added → Changed → Fixed → Tests → Removed → Security
- 描述侧重 **行为变更**（what + why），不是实现细节
- `### Tests` 条目汇总新增测试覆盖的场景，不逐条列出测试用例

## 修改Skill规范

不能够直接修改Superpowers和OpenSpec的原始Skill

