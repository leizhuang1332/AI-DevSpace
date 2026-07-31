# 04 — Silent UX:删 [+] / [⚠ 待裁决] / [接受风险] / [重扫] / [生成技术概要] + 不挂载 `<SessionTabs>` + 清理 orphan mocks

**What to build:** The ANALYZING workspace's primary UI is reduced to its minimum: a top bar (placeholder for the upcoming Pack dropdown in 05), 5 admission dimension cards, a verdict badge, and a single 「▶ 开始分析」 CTA. All AI-prompting UI affordances are removed — there's no "+ new session" button, no "pending adjudication" badge, no "accept risk" override, no "rescan", no "generate tech brief". The session-tab strip is un-mounted (component file retained for v1.1 reuse). Orphan mock generators with no UI consumers are deleted.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `AdmissionDashboard` no longer renders: `[+ 新建]` sibling button, 「⚠ 待裁决」 badge, 「接受风险」 button, 「重扫」 / 「生成技术概要」 buttons
- [ ] `AdmissionDashboard` always renders the verdict badge; takes a single start callback; no `onAcceptRisk` prop is consumed
- [ ] `<SessionTabs>` is no longer imported or rendered by `analyzing-zone.tsx`; the component file is retained on disk
- [ ] `<CreateSessionDialog>` (the "新建分析会话" modal in session-tabs) is no longer reachable from any UI path
- [ ] Inside `TechBriefPanel` (or wherever the [重扫] / [生成技术概要] buttons live), those two buttons are removed; the panel may retain other content but is no longer the home of those CTAs
- [ ] Orphan mocks with no UI consumer are deleted from the analysis route file: `simulateInterjectChunks`, `buildMockBriefArtifacts` (and any associated state they'd back)
- [ ] `admission-dashboard.test.tsx` extended: no `+` / pending badge / accept-risk button / rescan / tech-brief button rendered; verdict badge present; start CTA functional
- [ ] `analyzing-zone.test.tsx` extended: `<SessionTabs>` does not appear in the rendered tree; `EmptyAnalyzing` fallback still works