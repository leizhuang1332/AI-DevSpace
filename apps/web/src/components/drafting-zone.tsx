'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  mockConvertToMarkdown,
  validateLaunch,
  type AuxFile,
  type UsageTag,
} from '@ai-devspace/shared'
import {
  attachReposToRequirement,
  fetchRepoPool,
  isAttachReposError,
} from '@/lib/repo-attach'
import {
  AUX_PANE_MIN_HEIGHT_PX,
  DEFAULT_PRD_RATIO,
  SPLIT_RESIZER_HEIGHT_PX,
  clampSplitRatio,
  shouldShowAttachBanner,
  type DraftingData,
  type DraftingRepo,
} from '@/lib/drafting'
import { DraftingPrdPane, type DraftingPrdPaneHandle } from './drafting-prd-pane'
import { AuxFilesPane } from './aux-files-pane'
import { DraggableDivider } from './draggable-divider'
import { AuxDrawer } from './aux-drawer'
import { NewAuxFileDialog } from './new-aux-file-dialog'
import { RepoBar } from './repo-bar'
import {
  DraftingBanner,
  type DraftingBannerState,
} from './drafting-banner'
import { DraftingSkeleton } from './drafting-skeleton'
import { AttachReposDialog } from './attach-repos-dialog'

/**
 * 弹层关闭后焦点回弹到触发按钮(issue 01 ticket 验收 #12)。
 *
 * 用 setTimeout 0 等 React commit 完成后再 focus(避免被卸载的 dialog 抢回焦点)。
 * trigger 是触发的入口标识;N=0 时 banner [+] 通常已被自动隐藏,可能落空 no-op。
 */
function focusReturnToTrigger(
  trigger: 'banner-plus' | 'repo-bar-add',
): void {
  window.setTimeout(() => {
    const selector =
      trigger === 'banner-plus'
        ? '[data-testid="drafting-banner-plus"]'
        : '[data-testid="repo-bar-add"], [data-testid="repo-bar-add-more"]'
    const el = document.querySelector<HTMLButtonElement>(selector)
    el?.focus()
  }, 0)
}

/**
 * DRAFTING 工位组件(issue 02 + 04 + 05 + 06 + 08)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 08 形态 —— PRD 顶置 + 拖拽分割 + 辅助文件网格 + 仓库底部条):
 * ┌────────────────────────────────────────────────┐
 * │ Toolbar(面包屑 + 自动保存状态)                  │
 * ├────────────────────────────────────────────────┤
 * │ 主区:上下分割的 flex 列                         │
 * │  ┌────────────────────────────────────────┐    │
 * │  │ PRD 卡片(标题 + 编辑器)  [ratio ~60%]   │    │
 * │  ├────────────────────────────────────────┤    │
 * │  │ ‖ 拖拽分割条(6px)              ‖      │    │
 * │  ├────────────────────────────────────────┤    │
 * │  │ 辅助文件网格 + 创建/上传 [1-ratio]   │    │
 * │  └────────────────────────────────────────┘    │
 * │ ═══════════════ 仓库底部条(issue 08)═══════════│
 * │ 关联仓库  ✓ …  ✓ …  ＋ …  ⚠ 仅 1 个仓库 …  ▶   │
 * └────────────────────────────────────────────────┘
 * + 右侧 Inline 栏(由 ZoneShell 注入 DraftingSkillRail)
 *
 * 数据全部由 props 注入;交互逻辑委托给 DraftingPrdPane('use client')。
 * Inline 栏(候命 Skill)由 ZoneShell 通过 inlineRailSlot 注入 DraftingSkillRail。
 *
 * 关键设计点:
 * - **issue 08**:prdMarkdown 状态上提到本组件持有,作为受控 props
 *   传给 DraftingPrdPane。父组件用 `validateLaunch` 派生 canLaunch,
 *   传给 RepoBar;RepoBar 完全不感知 prdMarkdown(单一职责)。
 * - **issue 04 ticket**:title 不再受控(已由 NewRequirementModal 写入
 *   meta.yaml.title),本组件直接读 data.title 用于弹层标题等场景,
 *   DRAFTING 内不暴露编辑入口。
 * - **issue 08**:selectedRepoIds 由本组件持 state;切换由 RepoBar 触发
 *   onToggleRepo → setSelectedRepoIds(派生软警告 + chip on/off)。
 * - 上下比例 ratio ∈ [0, 1];clamp 由 `clampSplitRatio` 集中负责
 * - **issue 06**:`auxFiles` 由 props 初始值拷贝到 local state,
 *   创建 / 上传的新文件 append 到 state;创建 / 上传后自动打开抽屉
 * - 抽屉与新建对话框同一时刻只能存在其一(互斥)
 * - id 生成:单调递增计数器 + 前缀;新文件 = `aux-new-<n>`,上传 = `aux-up-<n>`
 *
 * 不在本组件范围:
 * - 仓库创建 / 删除(后续接 agent API 时再扩展;当前 mock 阶段只支持选中)
 */

export function DraftingZone({ data }: { data: DraftingData }) {
  const router = useRouter()

  // -------------------------------------------------------------------------
  // 上下分割比例(issue 04)
  // -------------------------------------------------------------------------
  const [prdRatio, setPrdRatio] = useState<number>(DEFAULT_PRD_RATIO)

  // -------------------------------------------------------------------------
  // 受控 PRD 字段(issue 08 上提 + issue 04 ticket 收窄)—— DraftingPrdPane 改为受控组件
  // - title 不再是受控字段:由 NewRequirementModal 一次性写入 meta.yaml.title,
  //   本组件直接读 data.title(列表页 / 面包屑 / hero 同源)
  // -------------------------------------------------------------------------
  const [prdMarkdown, setPrdMarkdown] = useState<string>(data.prdMarkdown)

  // -------------------------------------------------------------------------
  // 仓库选中(issue 08)—— 由 props 初始值拷贝到 local state
  // -------------------------------------------------------------------------
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>(
    data.selectedRepoIds,
  )

  // -------------------------------------------------------------------------
  // 实时仓库池(issue 06 · 决策 76 / ADR-0016 D4)
  // - 初始值 = data.repos(SSR 期由 `getDraftingData` 注入的真实仓库池)
  // - 弹层打开(`attachDialogOpen` 翻 true)时由 useEffect refetch 一次;
  //   成功 → 覆盖;失败 → 静默沿用当前列表,符合决策 24"不打扰"
  // - 用单独的 state 而非直接 mutate data.repos,避免 props 漂移破坏 SSR
  // -------------------------------------------------------------------------
  const [liveRepos, setLiveRepos] = useState<DraftingRepo[]>(data.repos)

  // -------------------------------------------------------------------------
  // 关联仓库弹层 + 分支名 + banner(issue 01 ticket · ticket 02 部分成功)
  // - mountSkeletonDone:首挂时 1.5s skeleton,完成后才显示主区
  // - bannerState:hidden / success / partial / error 四态,受 DraftingZone 持有
  // - bannerPartialSummary:partial 态显示「已关联 N · 失败 M:…」+ 重试按钮
  // - attachDialogOpen / attachDialogMode:弹层受控 + 首次/追加两种 mode
  // - lockedBranchName:首次关联成功后写入,后续追加模式复用
  // - pendingAttachTrigger:弹层关闭后焦点回触发按钮(banner [+] / RepoBar ＋)
  // - attachInFlight:防止重复提交期间的 UI 闪烁
  // - failedRepoIds:本次关联中失败的 repo(用于 chip 标红 / 重试该 repo)
  // -------------------------------------------------------------------------
  const [mountSkeletonDone, setMountSkeletonDone] = useState<boolean>(false)
  const [bannerState, setBannerState] = useState<DraftingBannerState>(
    shouldShowAttachBanner(data.selectedRepoIds) ? 'success' : 'hidden',
  )
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false)
  const [bannerErrorMessage, setBannerErrorMessage] = useState<string | null>(
    null,
  )
  const [bannerPartialSummary, setBannerPartialSummary] = useState<
    { succeeded: number; failedNames: string[] } | undefined
  >(undefined)
  const [failedRepoIds, setFailedRepoIds] = useState<string[]>([])
  const [attachDialogOpen, setAttachDialogOpen] = useState<boolean>(false)
  const [attachDialogMode, setAttachDialogMode] =
    useState<'first' | 'append'>('first')
  const [lockedBranchName, setLockedBranchName] = useState<string>('')
  const [pendingAttachTrigger, setPendingAttachTrigger] = useState<
    'banner-plus' | 'repo-bar-add' | null
  >(null)
  const [attachInFlight, setAttachInFlight] = useState<boolean>(false)

  // Mount 后 1.5s skeleton 切换到主区(决策 30 + issue 01 ticket 验收 #1)
  // 仅在「新建需求」(data.empty === true)时启用;已存需求直接进入主区
  useEffect(() => {
    if (!data.empty) {
      setMountSkeletonDone(true)
      return
    }
    const id = window.setTimeout(() => {
      setMountSkeletonDone(true)
    }, 1500)
    return () => window.clearTimeout(id)
  }, [data.empty])

  // 当 selectedRepoIds 首次出现 ≥1 时,自动隐藏 success banner(决策 E10 +
  // ticket 验收「首次在 RepoBar 成功勾选第一个 repo 后 banner 自动消失」)
  const prevSelectedCountRef = useRef<number>(data.selectedRepoIds.length)
  useEffect(() => {
    const wasZero = prevSelectedCountRef.current === 0
    const isZero = selectedRepoIds.length === 0
    prevSelectedCountRef.current = selectedRepoIds.length
    if (wasZero && !isZero && bannerState === 'success') {
      setBannerState('hidden')
      setBannerDismissed(false)
    }
    // 注:用户主动 ✕ 后(bannerDismissed=true)selectedRepoIds 仍为 0 时,
    // 不再恢复 success —— 保持「关后不闪」的语义(ticket 验收 #7)
  }, [selectedRepoIds.length, bannerState])

  // -------------------------------------------------------------------------
  // 弹层打开时 refetch 仓库池(issue 06 · 决策 76 / ADR-0016 D4)
  // - 只在 attachDialogOpen 翻 true 时触发(不重复轮询)
  // - 成功 → setLiveRepos(覆盖),失败 → 静默保留当前列表
  // - AbortController:组件 unmount 时取消在飞请求,避免 setState on unmounted
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!attachDialogOpen) return
    const ac = new AbortController()
    fetchRepoPool({ signal: ac.signal })
      .then((pool) => setLiveRepos(pool.repos))
      .catch((err) => {
        if (err?.name === 'AbortError') return
        // 静默 fallback —— 保留 liveRepos(决策 24 不打扰)
      })
    return () => ac.abort()
  }, [attachDialogOpen])

  // -------------------------------------------------------------------------
  // 命令式句柄:DraftingPrdPane 暴露 saveNow(),用于 launch 前立刻落盘
  // -------------------------------------------------------------------------
  const prdPaneHandleRef = useRef<DraftingPrdPaneHandle | null>(null)

  // -------------------------------------------------------------------------
  // Launch validity(issue 01 验收 #5 + issue 04 ticket 收窄 + issue 08 验收 #7 #8)
  // - 仅依赖 prdMarkdown(issue 04 ticket:title 不再是受控字段);
  //   不读仓库数量(issue 08 验收 #7)
  // - 派生给 RepoBar 用于 disabled 态 + 给 hint 计算
  // -------------------------------------------------------------------------
  const validity = useMemo(
    () => validateLaunch({ prdMarkdown }),
    [prdMarkdown],
  )

  // -------------------------------------------------------------------------
  // Launch disabled hint(issue 08 + issue 04 ticket 收窄)—— 父组件计算文案,传给 RepoBar
  // 对应 issue 02 时期的 PRD 卡片脚提示文案(迁出 PRD 卡片后保留视觉反馈)
  // issue 04 ticket:title 不再受控 → hint 简化为单分支文案
  // -------------------------------------------------------------------------
  const launchDisabledHint = useMemo<string | undefined>(() => {
    if (validity.canLaunch) return undefined
    return '请填写 PRD Markdown'
  }, [validity.canLaunch])

  // -------------------------------------------------------------------------
  // 辅助文件列表(issue 04 + 06)
  // - 拷贝 props 初始值到 local state,新文件 / 上传走 setAuxFiles
  // - mock 阶段;后续接 agent API 时由 useDraftingData hook 持有 + 同步
  // -------------------------------------------------------------------------
  const [auxFiles, setAuxFiles] = useState<AuxFile[]>(data.auxFiles)
  // 防止 props 改变时 state 被意外覆盖:仅首次拷贝,后续由本地操作驱动
  // (典型的 "lifting state up" 反模式规避)
  // issue 04 ticket:title 不再上提为受控 state,同步列表里删去 setTitle(data.title)
  const [lastRequirementId, setLastRequirementId] = useState<string>(data.requirementId)
  useEffect(() => {
    if (lastRequirementId !== data.requirementId) {
      setAuxFiles(data.auxFiles)
      setPrdMarkdown(data.prdMarkdown)
      setSelectedRepoIds(data.selectedRepoIds)
      setLastRequirementId(data.requirementId)
    }
    // intentionally only when requirementId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.requirementId])

  // -------------------------------------------------------------------------
  // 辅助文件抽屉状态(issue 05)
  // -------------------------------------------------------------------------
  const [openAuxId, setOpenAuxId] = useState<string | null>(null)
  const [auxBodies, setAuxBodies] = useState<Record<string, string>>({})

  /** 受控回调 —— AuxDrawer 通知 body 变化 */
  const handleAuxBodyChange = useCallback((id: string, newBody: string) => {
    setAuxBodies((prev) => ({ ...prev, [id]: newBody }))
  }, [])

  // -------------------------------------------------------------------------
  // 新建对话框状态(issue 06)
  // - open=true → 弹出 NewAuxFileDialog
  // - 在 open=true 期间抽屉被强制关闭(单一焦点)
  // - errorMessage 用于文件名冲突 / 上传转换失败时的视觉提示
  // -------------------------------------------------------------------------
  const [showNewDialog, setShowNewDialog] = useState<boolean>(false)
  const [newDialogError, setNewDialogError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // id 计数器(单调递增,用于创建/上传产生的 AuxFile.id)
  // -------------------------------------------------------------------------
  const idCounterRef = useRef<number>(0)
  const nextId = (prefix: string): string => {
    idCounterRef.current += 1
    return `${prefix}-${idCounterRef.current}`
  }

  // -------------------------------------------------------------------------
  // PRD 编辑器 ref 回调
  // -------------------------------------------------------------------------
  const splitContainerRef = useRef<HTMLDivElement | null>(null)

  /** 主区实测高度;0 表示尚未测量(SSR / 首次 render 之前) */
  const [containerHeight, setContainerHeight] = useState<number>(0)

  /** 拖拽起点信息;DraggableDivider 触发 onDragStart 时写入 */
  const dragStartRef = useRef<{ startClientY: number; startRatio: number } | null>(
    null,
  )

  // -------------------------------------------------------------------------
  // 监听窗口尺寸变化 → 重测容器高度 → 重算 clamp 后的 ratio
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = splitContainerRef.current
    if (!el) return

    const measure = () => {
      const h = el.getBoundingClientRect().height
      setContainerHeight(h)
    }

    measure()

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null
    if (observer) observer.observe(el)
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // -------------------------------------------------------------------------
  // clamp 后的实际 ratio —— 用于渲染 flexGrow
  // -------------------------------------------------------------------------
  const effectiveRatio =
    containerHeight > 0 ? clampSplitRatio(prdRatio, containerHeight) : prdRatio

  // -------------------------------------------------------------------------
  // 拖拽事件 → ratio 增量
  // -------------------------------------------------------------------------
  const handleDragStart = useCallback(
    (startClientY: number) => {
      dragStartRef.current = {
        startClientY,
        startRatio: prdRatio,
      }
    },
    [prdRatio],
  )

  const handleDrag = useCallback((clientY: number) => {
    const el = splitContainerRef.current
    if (!el) return
    const containerH = el.getBoundingClientRect().height
    if (containerH <= 0) return

    setPrdRatio((prevRatio) => {
      const start = dragStartRef.current
      if (!start) {
        dragStartRef.current = {
          startClientY: clientY,
          startRatio: prevRatio,
        }
        return prevRatio
      }
      const deltaRatio = (clientY - start.startClientY) / containerH
      return start.startRatio + deltaRatio
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    dragStartRef.current = null
  }, [])

  const handleRatioChangeBy = useCallback((delta: number) => {
    setPrdRatio((prev) => prev + delta)
  }, [])

  // -------------------------------------------------------------------------
  // 辅助文件 / 新建 / 上传(issue 05 / 06)
  // -------------------------------------------------------------------------
  const handleAuxOpen = useCallback((auxId: string) => {
    setOpenAuxId(auxId)
  }, [])

  const handleAuxClose = useCallback(() => {
    setOpenAuxId(null)
  }, [])

  /**
   * PRD 预览 / 抽屉预览内点击相对 Markdown 链接 → 打开/切换抽屉(issue 07)
   *
   * 单抽屉语义由 `openAuxId` 的单值状态天然保证:
   * - 抽屉关闭 → 直接打开目标文件
   * - 抽屉已开 + 不同文件 → 切换(React state setter 替换 id,Drawer useMemo 重新计算 currentFile)
   * - 抽屉已开 + 同文件 → no-op(setState 同值不触发 re-render)
   *
   * 不在此处校验 target 是否存在 —— resolveAuxLink 已经在 MarkdownPreview
   * 里过滤过;传进来的 target 必然是已知 AuxFile。
   */
  const handleAuxLinkClick = useCallback((target: AuxFile) => {
    setOpenAuxId(target.id)
  }, [])

  /** 头部 "＋ 新建" 按钮 / 空态占位卡 → 打开新建对话框 */
  const handleAuxCreate = useCallback(() => {
    setNewDialogError(null)
    setShowNewDialog(true)
  }, [])

  /**
   * 新建对话框提交 → 在列表中追加 AuxFile + 打开抽屉
   * - 冲突检测:同 filename 已存在 → 报错留在对话框中(不关闭),让用户改名
   */
  const handleAuxCreateSubmit = useCallback(
    (value: { filename: string; usage_tag: UsageTag }) => {
      const conflict = auxFiles.find(
        (f) => f.filename.toLowerCase() === value.filename.toLowerCase(),
      )
      if (conflict) {
        setNewDialogError(
          `已存在同名文件 "${conflict.filename}",请换一个文件名。`,
        )
        return
      }
      // 空 Markdown(issue 06 验收 #2:creates a new AuxFile with empty Markdown)
      const newFile: AuxFile = {
        id: nextId('aux-new'),
        filename: value.filename,
        body: '',
        usage_tag: value.usage_tag,
        source_format: 'md',
        converted_to_md: false,
      }
      setAuxFiles((prev) => [...prev, newFile])
      setShowNewDialog(false)
      setNewDialogError(null)
      setOpenAuxId(newFile.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auxFiles],
  )

  /**
   * 头部 "📁 上传" 按钮收到 File:
   * 1) 读文件内容(.md 走 readAsText;.docx / .pdf 同样走 readAsText,内容
   *    实际不可用,但 mock 适配器只关心 filename → 仍能派生 deterministic body)
   * 2) 走 mockConvertToMarkdown → 拿 body / source_format / converted_to_md
   * 3) 冲突 → 打开新建对话框并预填错误(便于用户改名)
   * 4) 成功 → append + 打开抽屉
   */
  const handleAuxUpload = useCallback(
    (file: File) => {
      // 防御性:扩展名必须受支持
      const lower = file.name.toLowerCase()
      if (
        !lower.endsWith('.md') &&
        !lower.endsWith('.docx') &&
        !lower.endsWith('.pdf')
      ) {
        setNewDialogError(
          `不支持的格式 "${file.name}",仅支持 .md / .docx / .pdf`,
        )
        setShowNewDialog(true)
        return
      }

      // 文件名需以 .md 存储(.docx / .pdf 转换后也是 markdown 文件)
      const storedFilename = lower.endsWith('.md')
        ? file.name
        : `${file.name.replace(/\.(docx|pdf)$/i, '')}.md`

      // 冲突检测:同 filename 已存在 → 引导用户改名
      const existing = auxFiles.find(
        (f) => f.filename.toLowerCase() === storedFilename.toLowerCase(),
      )
      if (existing) {
        setNewDialogError(
          `已存在同名文件 "${existing.filename}",请先改名或删除旧文件再上传。`,
        )
        setShowNewDialog(true)
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const content = String(reader.result ?? '')
        let body: string
        let source_format: 'md' | 'docx' | 'pdf'
        let converted_to_md: boolean
        try {
          const out = mockConvertToMarkdown({
            filename: file.name,
            content,
          })
          body = out.body
          source_format = out.source_format
          converted_to_md = out.converted_to_md
        } catch (err) {
          // mock 本身对未知扩展名已经抛错,这里再兜底一次
          setNewDialogError(
            err instanceof Error ? err.message : 'mock 转换失败',
          )
          setShowNewDialog(true)
          return
        }

        const newFile: AuxFile = {
          id: nextId('aux-up'),
          filename: storedFilename,
          body,
          // usage_tag:从文件名/扩展名启发式;后续可在 drawer 内让用户调整
          usage_tag: 'other',
          source_format,
          converted_to_md,
        }
        setAuxFiles((prev) => [...prev, newFile])
        setOpenAuxId(newFile.id)
      }
      reader.onerror = () => {
        setNewDialogError(`读取文件 ${file.name} 失败,请重试`)
        setShowNewDialog(true)
      }
      // mock 期都按文本读(.docx / .pdf 的二进制内容会被保留为乱码,但
      // mockConvertToMarkdown 不解析,只取 filename 派生 deterministic body)
      reader.readAsText(file)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auxFiles],
  )

  // -------------------------------------------------------------------------
  // 仓库 chip 切换(issue 08)—— RepoBar 触发
  // - 真实仓库可切换;id 以 "repo-more" 开头 / 名为 "＋ 更多仓库…" 的占位
  //   chip 视为"添加更多"动作(no-op,mock 期无后端联动),不允许进入 selectedRepoIds
  //   (避免用户误把"占位 chip"当真实仓库勾选,触发软警告/选中数等虚假视觉)
  // -------------------------------------------------------------------------
  const isRealSelectableRepo = useCallback(
    (repoId: string) => {
      const repo = liveRepos.find((r) => r.id === repoId)
      if (!repo) return false
      // 防御性:任何 name 以 "＋" 开头的占位条目都不可选中
      if (repo.name.startsWith('＋')) return false
      return true
    },
    [liveRepos],
  )

  const handleToggleRepo = useCallback(
    (repoId: string) => {
      if (!isRealSelectableRepo(repoId)) return
      setSelectedRepoIds((prev) =>
        prev.includes(repoId)
          ? prev.filter((id) => id !== repoId)
          : [...prev, repoId],
      )
    },
    [isRealSelectableRepo],
  )

  // -------------------------------------------------------------------------
  // 关联仓库弹层(issue 01 ticket)—— 入口共两处(banner [+] / RepoBar ＋)
  // 模式由 selectedRepoIds 当前状态决定:
  // - 空 → 'first',首次关联,需填分支名
  // - 已选 ≥1 → 'append',追加,分支名沿用 lockedBranchName
  // -------------------------------------------------------------------------
  const openAttachDialog = useCallback(
    (trigger: 'banner-plus' | 'repo-bar-add') => {
      if (attachInFlight) return
      setPendingAttachTrigger(trigger)
      // mode 决策:lockedBranchName 非空 = 已锁定(append);否则 = 首次关联(first)
      // 注:不能用 selectedRepoIds.length 判定 —— 已有需求(预选 N repo 但未走弹层
      // 锁定分支)点 ＋ 也会进入 append 模式,但此时 lockedBranchName==='' 会导致
      // 锁定 banner 渲染成「将使用统一分支名 —」(UI-POLISH-SPEC §9.2 语义违和)
      setAttachDialogMode(lockedBranchName ? 'append' : 'first')
      setAttachDialogOpen(true)
    },
    [attachInFlight, lockedBranchName],
  )

  const closeAttachDialog = useCallback(() => {
    const trigger = pendingAttachTrigger
    setAttachDialogOpen(false)
    setPendingAttachTrigger(null)
    // 弹层关闭后焦点回到触发按钮(spec 要求)
    if (trigger) focusReturnToTrigger(trigger)
  }, [pendingAttachTrigger])

  // -------------------------------------------------------------------------
  // 关联仓库提交(issue 01 ticket + ticket 02 真实 worktree 创建)
  // - 三态:
  //   - 全部成功 → banner hidden + 锁定 branchName + selectedRepoIds 合并
  //   - 部分成功 → banner partial(橙色) + 成功的写入 selectedRepoIds
  //   - 全部失败 / 网络 / 鉴权错 → banner error + errorMessage
  // - 鉴权 401 单独映射为「鉴权失败」中文文案(不让 AgentError JSON 暴露给用户)
  // - 重试该 repo:父组件把 failedRepoIds 重新塞进弹层(下次 onSubmit 自动用)
  // -------------------------------------------------------------------------
  const submitAttach = useCallback(
    async (value: { repoIds: string[]; branchName: string }) => {
      setAttachInFlight(true)
      try {
        // 调用真实 Agent 端 API
        const res = await attachReposToRequirement(data.requirementId, {
          repoIds: value.repoIds,
          branchName: value.branchName,
        })

        // 1. 分类 results(类型守卫 done by Zod)
        const succeededIds: string[] = []
        const failedIds: string[] = []
        const failedMessages: string[] = []
        for (const r of res.results) {
          if (r.ok) succeededIds.push(r.repoId)
          else {
            failedIds.push(r.repoId)
            failedMessages.push(`${r.repoId}:${r.message}`)
          }
        }

        // 2. 合并 selectedRepoIds(只增不删,失败的不进)
        if (succeededIds.length > 0) {
          setSelectedRepoIds((prev) => {
            const merged = [...prev]
            for (const id of succeededIds) {
              if (!merged.includes(id)) merged.push(id)
            }
            return merged
          })
        }

        // 3. 锁分支名(只有至少 1 个成功才锁定,避免追加模式误锁空分支)
        if (succeededIds.length > 0 && value.branchName) {
          setLockedBranchName(value.branchName)
        }

        // 4. 状态机分支
        if (failedIds.length === 0) {
          // 全成功
          setFailedRepoIds([])
          setBannerPartialSummary(undefined)
          setBannerState('hidden')
          setBannerErrorMessage(null)
          setBannerDismissed(false)
        } else if (succeededIds.length > 0) {
          // 部分成功(橙色 #fff7ed banner)
          setFailedRepoIds(failedIds)
          setBannerPartialSummary({
            succeeded: succeededIds.length,
            failedNames: failedIds,
          })
          setBannerState('partial')
          setBannerErrorMessage(null)
        } else {
          // 全失败(走 error banner,显示首个失败详情)
          setFailedRepoIds(failedIds)
          setBannerPartialSummary(undefined)
          setBannerState('error')
          setBannerErrorMessage(
            failedMessages[0] ?? '关联失败,请重试',
          )
        }

        setAttachDialogOpen(false)
        const trigger = pendingAttachTrigger
        setPendingAttachTrigger(null)
        if (trigger) focusReturnToTrigger(trigger)
      } catch (err) {
        // 网络错 / 鉴权错 / schema 校验错 等
        setAttachDialogOpen(false)
        setFailedRepoIds(value.repoIds)
        setBannerPartialSummary(undefined)
        setBannerState('error')
        // 401 鉴权失败 → 中文文案(避免 AgentError 的 JSON 直接显示给用户)
        const message = isAttachReposError(err) && err.status === 401
          ? '鉴权失败'
          : err instanceof Error
            ? err.message
            : '关联失败,请重试'
        setBannerErrorMessage(message)
        setPendingAttachTrigger(null)
      } finally {
        setAttachInFlight(false)
      }
    },
    [data.requirementId, pendingAttachTrigger],
  )

  const handleBannerDismiss = useCallback(() => {
    setBannerState('hidden')
    setBannerDismissed(true)
  }, [])

  const handleBannerRetry = useCallback(() => {
    // 重试:回到 first / append 弹层(由 selectedRepoIds 决定),用户重新选
    setBannerErrorMessage(null)
    setBannerState('hidden')
    openAttachDialog('banner-plus')
  }, [openAttachDialog])

  /**
   * ticket 02 部分成功 → 「重试该 repo」按钮回调
   * - 重新打开 attach dialog,模式由 lockedBranchName 决定
   * - 把 failedRepoIds 注入 pickedRepoIds 让它们默认勾选(用户提交时直接重试这些)
   * - 把 failedRepoIds 同步写到 selectedRepoIds state 以让 RepoBar 在 dialog 期间
   *   显示这些 chip 为"已选中 + 待重试"
   */
  const handleBannerRetryFailed = useCallback(
    (failedNames: string[]) => {
      // 把失败的 repo 临时加进 selectedRepoIds,这样打开 dialog 时 pickedRepoIds
      // 会包含它们(默认勾选)
      setSelectedRepoIds((prev) => {
        const merged = [...prev]
        for (const id of failedNames) {
          if (!merged.includes(id)) merged.push(id)
        }
        return merged
      })
      setBannerErrorMessage(null)
      setBannerPartialSummary(undefined)
      // 打开弹层;attach-repos-dialog 会用 selectedRepoIds 作 pickedRepoIds 默认勾选
      openAttachDialog('banner-plus')
    },
    [openAttachDialog],
  )

  // -------------------------------------------------------------------------
  // 包装 RepoBar 的 onRequestAttach —— 记录触发源,便于关闭后焦点回弹
  // -------------------------------------------------------------------------
  const handleRepoBarRequestAttach = useCallback(() => {
    openAttachDialog('repo-bar-add')
  }, [openAttachDialog])

  // -------------------------------------------------------------------------
  // 启动 ANALYZING(issue 02 验收 #7 + issue 08 验收 #7 #8)
  // - validity 已确保 canLaunch=true(否则 RepoBar 不会调用 onLaunch)
  // - 启动前触发一次"立刻落盘",保证下游工位拿到最新内容(issue 02 行为)
  // - 不改 Requirement status / 不启动 Agent / 仅 router.push
  // -------------------------------------------------------------------------
  const handleLaunch = useCallback(() => {
    if (!validity.canLaunch) return
    // 立刻保存一次(issue 02 行为;issue 08 迁到 RepoBar 时保留)
    prdPaneHandleRef.current?.saveNow()
    router.push(`/requirements/${data.requirementId}/analyzing/`)
  }, [validity.canLaunch, router, data.requirementId])

  // -------------------------------------------------------------------------
  // aria-valuemin / aria-valuemax 给 DraggableDivider 的 clamp 边界
  // -------------------------------------------------------------------------
  const minRatio =
    containerHeight > 0
      ? clampSplitRatio(0, containerHeight)
      : SPLIT_RESIZER_HEIGHT_PX / Math.max(1, containerHeight)
  const maxRatio =
    containerHeight > 0 ? clampSplitRatio(1, containerHeight) : 1

  return (
    <main
      data-testid="drafting-zone"
      data-requirement-id={data.requirementId}
      data-empty={data.empty ? 'true' : 'false'}
      data-prd-ratio={String(prdRatio)}
      data-effective-prd-ratio={String(effectiveRatio)}
      data-launch-valid={validity.canLaunch ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg relative"
    >
      {/* 主区始终渲染 —— 骨架屏以 overlay 形式覆盖,避免阻塞主区挂载
          (这样现有依赖即时查询 DOM 的测试仍可工作) */}
      <DraftingToolbar toolbar={data.toolbar} />

      {/* 顶部 banner(issue 01 ticket + ticket 02 部分成功态):hidden / success / partial / error 四态 */}
      <DraftingBanner
        state={bannerState}
        errorMessage={bannerErrorMessage ?? undefined}
        partialSummary={bannerPartialSummary}
        onRequestAttach={(trigger) => {
          // banner [+] / 重试 共用 openAttachDialog;banner-retry 归一为 banner-plus
          openAttachDialog(
            trigger === 'banner-retry' ? 'banner-plus' : trigger,
          )
        }}
        onDismiss={handleBannerDismiss}
        onRetry={handleBannerRetry}
        onRetryFailed={handleBannerRetryFailed}
      />

      {/* 主区:上下分割的 flex 列(issue 04) */}
      <div
        data-testid="drafting-main"
        className="flex-1 overflow-auto p-6 bg-bg"
      >
        <div className="max-w-[1080px] mx-auto flex flex-col">
          <div
            ref={splitContainerRef}
            data-testid="drafting-split-row"
            className="flex flex-col min-h-0"
          >
            {/* PRD 卡片 —— wrapper 控制 flexGrow,内部仍是 issue 02/03 布局 */}
            <div
              data-testid="drafting-prd-wrapper"
              data-flex-grow={String(effectiveRatio)}
              style={{ flexGrow: effectiveRatio, minHeight: 0 }}
              className="overflow-hidden"
            >
              <DraftingPrdPane
                data={data}
                prdMarkdown={prdMarkdown}
                onPrdMarkdownChange={setPrdMarkdown}
                handle={prdPaneHandleRef}
                onAuxLinkClick={handleAuxLinkClick}
              />
            </div>

            {/* 拖拽分割条 —— 固定 6px 高 */}
            <DraggableDivider
              ratio={prdRatio}
              minRatio={minRatio}
              maxRatio={maxRatio}
              onDragClientY={handleDrag}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onRatioChangeBy={handleRatioChangeBy}
              ariaLabel="拖拽调整 PRD 与辅助文件的比例"
            />

            {/* 辅助文件面板 —— flexGrow = 1 - ratio(自动;不显式传,浏览器按剩余空间分配) */}
            <div
              data-testid="drafting-aux-wrapper"
              data-flex-grow={String(Math.max(0, 1 - effectiveRatio))}
              style={{ flexGrow: Math.max(0, 1 - effectiveRatio), minHeight: 0 }}
              className="overflow-hidden"
            >
              <AuxFilesPane
                auxFiles={auxFiles}
                onOpen={handleAuxOpen}
                onCreate={handleAuxCreate}
                onCreateClick={handleAuxCreate}
                onUpload={handleAuxUpload}
              />
            </div>
          </div>

          {/* 仓库底部条(issue 08 + 01 ticket + ticket 02 验收 #8 #9)—— sticky bottom,
              含 chips / 软警告 / 「＋」追加 / 启动 / 失败标红 / 绿色小圆点 */}
          <div className="mt-3 -mx-6 -mb-6">
            <RepoBar
              repos={liveRepos}
              selectedRepoIds={selectedRepoIds}
              failedRepoIds={failedRepoIds}
              attachedBranchName={lockedBranchName}
              onToggleRepo={handleToggleRepo}
              canLaunch={validity.canLaunch}
              launchDisabledHint={launchDisabledHint}
              onLaunch={handleLaunch}
              onRequestAttach={handleRepoBarRequestAttach}
            />
          </div>
        </div>
      </div>

      {/* 骨架屏 overlay(issue 01 ticket · 决策 30):
          - 仅在新建需求(data.empty === true)时启用 1.5s
          - 渲染为绝对定位 overlay 覆盖整个 main;1.5s 后自动隐藏
          - 用 `pointer-events-none` 让下层内容在挂载后即可交互(测试 / 自动化) */}
      {!mountSkeletonDone && data.empty && (
        <div
          data-testid="drafting-skeleton-overlay"
          className="absolute inset-0 z-30 bg-bg/90 flex items-center justify-center pointer-events-none"
        >
          <DraftingSkeleton />
        </div>
      )}

      {/* 新建对话框(issue 06) — 提交或取消都关闭;错误(冲突)留在 dialog 内 */}
      <NewAuxFileDialog
        open={showNewDialog}
        errorMessage={newDialogError}
        onClose={() => {
          setShowNewDialog(false)
          setNewDialogError(null)
        }}
        onSubmit={handleAuxCreateSubmit}
      />

      {/* 关联 / 追加仓库弹层(issue 01 ticket)—— 受控 mode + open */}
      <AttachReposDialog
        open={attachDialogOpen}
        mode={attachDialogMode}
        titlePrefix={attachDialogMode === 'first' ? '关联仓库' : '追加仓库'}
        requirementTitle={data.title || data.requirementId}
        availableRepos={liveRepos}
        pickedRepoIds={selectedRepoIds}
        lockedBranchName={lockedBranchName}
        onSubmit={submitAttach}
        onClose={closeAttachDialog}
      />

      {/* 辅助文件抽屉(issue 05) —— 用 portal 思路直接渲染在主元素末尾,
          固定定位 + 高 z-index 覆盖全屏。父组件(DraftingZone)持有:
          - 当前打开文件 id(openAuxId)
          - 跨生命周期编辑内容(auxBodies) */}
      <AuxDrawer
        openAuxId={openAuxId}
        auxFiles={auxFiles}
        auxBodies={auxBodies}
        onClose={handleAuxClose}
        onBodyChange={handleAuxBodyChange}
        autosaveIntervalMs={data.autosaveIntervalMs}
        onAuxLinkClick={handleAuxLinkClick}
      />
    </main>
  )
}

// ============================================================================
// Toolbar
// ============================================================================

function DraftingToolbar({ toolbar }: { toolbar: DraftingData['toolbar'] }) {
  return (
    <div
      data-testid="drafting-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="drafting-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={
              c.current ? 'drafting-crumb-current' : 'drafting-crumb-item'
            }
            data-current={c.current ? 'true' : 'false'}
            className={
              c.current
                ? 'text-text-1 font-medium'
                : i % 2 === 1
                  ? 'text-text-3'
                  : 'text-text-2'
            }
          >
            {c.label}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <span
          data-testid="drafting-toolbar-status"
          className="text-xs text-text-3"
        >
          {toolbar.statusText}
        </span>
      </div>
    </div>
  )
}