# Task 5-d — subagent (client-ui-high)

## Task
修复客户端 UI 层 4 个 High 问题（UI-002 会话切换竞态、UI-003 恢复会话截图渲染、UI-005 缩放模态 a11y、UI-006 molstar loader 卡死）+ AGENT-011 客户端部分（去掉服务端工具结果伪造）。

## Situation on entry
工作树里已有一轮先前 5-d 尝试留下的未提交改动（与 5-a/5-b 的"子代理超时但代码已改完"模式一致），覆盖了全部 4 个目标文件。本 run 的工作是：逐条对照任务规格**审计既有改动的完整性**，补齐缺口，加固薄弱点，跑 lint 验证。

## Audit results (per issue)
1. **UI-002 (use-agent-session.ts)** — 已就位：abortRef (L431)、driveLoop fresh controller + fetch signal (L1057/1075)、AbortError 静默 (L1149-1150)、三个导航回调入口 abort (startNewSession L1273 / loadSession L1310 / forkFromSeq L1376 附近)。**缺口**：abort 只在 fetch 抛错时退出循环，若 loop 卡在 waitForApproval 轮询或长工具执行中，abort 后仍会执行后续客户端工具（污染新会话的 viewer 状态）。→ 本 run 补了 2 处显式 `controller.signal.aborted` 检查（while 顶部 L1070 + toolCalls for-loop 顶部 L1103），abort 即刻退出。
2. **UI-003 client** — projectNodes fallback (L340-375) 解析路径正确：服务端（5-a/R165）对 capture_multi_angle / capture_snapshot / recapture_screenshot 持久化完整 JSON（含 data:image URI，无截断），客户端 JSON.parse → n.result → extractScreenshots 渲染。无残留占位文本 hack。**发现渲染缺口**：`recapture_screenshot` 在 pdb-tools toolToCommand 里映射到同一条 capture_multi_angle 命令、结果形状完全一致，但 ToolCallCard extractScreenshots 按 name 白名单只认 capture_multi_angle/capture_snapshot → recapture 的截图（live 和 resume 都）渲染成原始 JSON 文本。→ 修复：extractScreenshots 白名单加入 recapture_screenshot (ToolCallCard.tsx L344-350)。
3. **UI-005 (ToolCallCard.tsx L371-429, L538-560)** — 已就位：role="dialog" + aria-modal="true" + aria-label + tabIndex=-1；open 时 focus 移入 + close 时还原（useEffect L375-383）；Escape/←/→/Tab 键处理（Tab 首尾循环 trap，无新库）；关闭/导航按钮全部 aria-label；ChatPanel 全局 Escape 前检查 `document.querySelector('[role="dialog"][aria-modal="true"]')` 跳过 blur（ChatPanel.tsx L107-112）。Escape 的 stopPropagation 与 querySelector 检查构成双保险。
4. **UI-006 (use-molstar-loader.ts)** — 已就位：onerror 移除失败 script 标签 + 清 `__molstarScriptLoading` (L106-114)；polling 分支 60×500ms 上限 + 标志已清仍无 global 时 setError (L52-88)；成功路径的 tag/flag 保留语义不变。
5. **AGENT-011 client (use-agent-session.ts)** — 已就位：executeToolCall 拒绝执行服务端工具（返回显式 error，console.warn，L588-593，替代原 `{ ok: true, result: { note: 'executed server-side' } }` 伪造）；driveLoop 跳过提交 + console.warn (L1108-1113)；全部被跳过则 `results.length === 0` 直接 return 不发空 POST (L1139-1141)。全库 grep "executed server-side" 无残留伪造点（唯一其他合成数据是 pairwise 单截图 VLM 默认值，显式标注"未进行VLM分析"，属合法 UI 语义非伪造）。

## Verification
- `NODE_OPTIONS=--max-old-space-size=3072 bun run lint` → **6592 problems (99 errors, 6493 warnings)**，与基线完全一致（全部预存在，无新增）。
- dev.log 无编译/运行错误；dev server 当前未监听（外部因素），lint 全量解析通过即为语法/规则验证。
- 未触碰 src/lib/**、未新增依赖、未写测试、未 build。

## Notes for future tasks
- 会话切换时若旧 drive 正卡在 waitForApproval：pendingApprovals 被清空 → 决议默认 'rejected' → 循环下一轮 fetch 抛 AbortError 静默退出 —— 与新增的 signal.aborted 检查共同保证不发任何 stale POST。
- 本任务范围内无需改 lib 的问题。
