'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mockConvertToMarkdown,
  type AuxFile,
  type UsageTag,
} from '@ai-devspace/shared'
import {
  AUX_PANE_MIN_HEIGHT_PX,
  DEFAULT_PRD_RATIO,
  SPLIT_RESIZER_HEIGHT_PX,
  clampSplitRatio,
  type DraftingData,
} from '@/lib/drafting'
import { DraftingPrdPane } from './drafting-prd-pane'
import { AuxFilesPane } from './aux-files-pane'
import { DraggableDivider } from './draggable-divider'
import { AuxDrawer } from './aux-drawer'
import { NewAuxFileDialog } from './new-aux-file-dialog'

/**
 * DRAFTING 工位组件(issue 02 + 04 + 05 + 06)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 04 形态 —— PRD 顶置 + 拖拽分割 + 辅助文件网格):
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
 * └────────────────────────────────────────────────┘
 * + 右侧 Inline 栏(由 ZoneShell 注入 DraftingSkillRail)
 *
 * 数据全部由 props 注入;交互逻辑委托给 DraftingPrdPane('use client')。
 * Inline 栏(候命 Skill)由 ZoneShell 通过 inlineRailSlot 注入 DraftingSkillRail。
 *
 * 关键设计点:
 * - 上下比例 ratio ∈ [0, 1];clamp 由 `clampSplitRatio` 集中负责
 * - **issue 06**:`auxFiles` 由 props 初始值拷贝到 local state,
 *   创建 / 上传的新文件 append 到 state;创建 / 上传后自动打开抽屉
 * - 抽屉与新建对话框同一时刻只能存在其一(互斥)
 * - id 生成:单调递增计数器 + 前缀;新文件 = `aux-new-<n>`,上传 = `aux-up-<n>`
 *
 * 不在本组件范围:
 * - 仓库底部条 + 软警告(issue 08)
 */

export function DraftingZone({ data }: { data: DraftingData }) {
  // -------------------------------------------------------------------------
  // 上下分割比例(issue 04)
  // -------------------------------------------------------------------------
  const [prdRatio, setPrdRatio] = useState<number>(DEFAULT_PRD_RATIO)

  // -------------------------------------------------------------------------
  // 辅助文件列表(issue 04 + 06)
  // - 拷贝 props 初始值到 local state,新文件 / 上传走 setAuxFiles
  // - mock 阶段;后续接 agent API 时由 useDraftingData hook 持有 + 同步
  // -------------------------------------------------------------------------
  const [auxFiles, setAuxFiles] = useState<AuxFile[]>(data.auxFiles)
  // 防止 props 改变时 state 被意外覆盖:仅首次拷贝,后续由本地操作驱动
  // (典型的 "lifting state up" 反模式规避)
  const [lastRequirementId, setLastRequirementId] = useState<string>(data.requirementId)
  useEffect(() => {
    if (lastRequirementId !== data.requirementId) {
      setAuxFiles(data.auxFiles)
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
      className="flex flex-col h-full overflow-hidden bg-bg"
    >
      <DraftingToolbar toolbar={data.toolbar} />

      {/* 主区:上下分割的 flex 列(issue 04) */}
      <div
        data-testid="drafting-main"
        className="flex-1 overflow-hidden p-6 bg-bg"
      >
        <div className="max-w-[1080px] mx-auto h-full flex flex-col">
          <div
            ref={splitContainerRef}
            data-testid="drafting-split-row"
            className="flex flex-col h-full min-h-0"
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
        </div>
      </div>

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
