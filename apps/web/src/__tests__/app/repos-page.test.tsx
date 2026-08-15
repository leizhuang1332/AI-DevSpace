/**
 * /repos 列表页 client 组件测试 — issue 07 / ADR-0030 D6
 *
 * 验收:
 * - 顶部文案「注册表 · N 个仓库」(去掉 · M 个 worktree)
 * - 搜索框 placeholder「搜索仓库名 / 地址 / 描述…」(去掉分支)
 * - 渲染 N 个 repo card(SSR 拉 /api/repos)
 * - 每个 card 显示「被 N 个需求使用」(并发拉 /api/repos/:name/usage)
 * - 客户端搜索过滤(name / gitUrl / description)
 * - 「+ 添加仓库」按钮触发 AddRepoModal
 * - hover 显示「编辑 / 删除」按钮
 * - 「删除」按钮触发 DeleteRepoDialog,确认后调 deleteRepo + 卡片消失
 *
 * mock 策略:
 * - AddRepoModal / DeleteRepoDialog 子组件 → vi.mock 简化,本测试只验证页面集成
 * - deleteRepo → vi.fn 受控
 *
 * page.tsx 是 RSC,负责 SSR 拉数据;本测试针对 ReposList client 组件,
 * 与 SSR 数据拉取解耦(SSR 数据通过 props 传入)。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// next/link 在 jsdom 里简化渲染
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const REPOS = [
  { name: 'refund-service', gitUrl: 'git@github.com:co/refund.git', description: '退款核心服务' },
  { name: 'order-service',  gitUrl: 'git@github.com:co/order.git',  description: '订单核心服务' },
  { name: 'member-service', gitUrl: 'git@github.com:co/member.git', description: '会员服务' },
]
const USAGE_MAP: Record<string, Array<{ requirementId: string; branch: string; codebasePath: string }>> = {
  'refund-service': [
    { requirementId: 'req-001', branch: 'feat/refund', codebasePath: '/tmp/r1' },
    { requirementId: 'req-007', branch: 'feat/refund-v2', codebasePath: '/tmp/r7' },
  ],
  'order-service': [
    { requirementId: 'req-001', branch: 'feat/refund', codebasePath: '/tmp/o1' },
  ],
  'member-service': [],
}

// AddRepoModal / DeleteRepoDialog → 简化 mock
let lastAddRepoProps: { onAdded?: (e: typeof REPOS[number]) => void; onClose?: () => void } = {}
let lastDeleteRepoProps: {
  repo?: typeof REPOS[number]
  usageCount?: number
  onConfirm?: (r: typeof REPOS[number]) => void
  onCancel?: () => void
} = {}

vi.mock('@/components/repos/AddRepoModal', () => ({
  AddRepoModal: (props: typeof lastAddRepoProps & { open: boolean }) => {
    lastAddRepoProps = props
    return props.open ? <div data-testid="add-repo-modal-mock">mock-add</div> : null
  },
}))
vi.mock('@/components/repos/DeleteRepoDialog', () => ({
  DeleteRepoDialog: (props: typeof lastDeleteRepoProps & { open: boolean }) => {
    lastDeleteRepoProps = props
    return props.open ? (
      <div data-testid="delete-repo-dialog-mock">
        <span data-testid="delete-repo-dialog-target">{props.repo?.name}</span>
        <button
          data-testid="delete-repo-dialog-confirm"
          onClick={() => props.onConfirm?.(props.repo!)}
        >
          confirm
        </button>
        <button data-testid="delete-repo-dialog-cancel" onClick={() => props.onCancel?.()}>cancel</button>
      </div>
    ) : null
  },
}))

// deleteRepo 受控
const mockDeleteRepo = vi.fn()
vi.mock('@/lib/repo-attach', () => ({
  deleteRepo: (...args: unknown[]) => mockDeleteRepo(...args),
}))

beforeEach(() => {
  mockDeleteRepo.mockClear()
  mockDeleteRepo.mockResolvedValue(undefined)
  lastAddRepoProps = {}
  lastDeleteRepoProps = {}
})

afterEach(() => cleanup())

async function renderReposList() {
  const { ReposList } = await import('@/app/(workspace)/repos/ReposList')
  return render(<ReposList repos={REPOS} usageByName={USAGE_MAP} />)
}

describe('/repos 列表页 · 文案与渲染', () => {
  it('顶部标题显示「仓库」', async () => {
    await renderReposList()
    expect(screen.getByTestId('repos-page-title').textContent).toBe('仓库')
  })

  it('顶部文案「3 个仓库」(去掉 worktree / 注册表前缀,符合 ADR-0030 D6)', async () => {
    await renderReposList()
    const summary = screen.getByTestId('repos-page-summary')
    expect(summary.textContent).toContain('3')
    expect(summary.textContent).toContain('个仓库')
    expect(summary.textContent).not.toContain('worktree')
    expect(summary.textContent).not.toContain('注册表')
  })

  it('搜索框 placeholder「搜索仓库名 / 地址 / 描述…」(去掉分支)', async () => {
    await renderReposList()
    const search = screen.getByTestId('repos-page-search') as HTMLInputElement
    expect(search.placeholder).toBe('搜索仓库名 / 地址 / 描述…')
  })

  it('渲染 3 个 repo card,每个含名称 / gitUrl / 描述 / 被 N 个需求使用', async () => {
    await renderReposList()
    expect(screen.getByTestId('repo-card-refund-service')).toBeInTheDocument()
    expect(screen.getByTestId('repo-card-order-service')).toBeInTheDocument()
    expect(screen.getByTestId('repo-card-member-service')).toBeInTheDocument()

    const refund = screen.getByTestId('repo-card-refund-service')
    expect(refund.textContent).toContain('refund-service')
    expect(refund.textContent).toContain('git@github.com:co/refund.git')
    expect(refund.textContent).toContain('退款核心服务')
    expect(screen.getByTestId('repo-card-usage-refund-service').textContent).toContain('2')

    expect(screen.getByTestId('repo-card-usage-order-service').textContent).toContain('1')
    expect(screen.getByTestId('repo-card-usage-member-service').textContent).toContain('0')
  })

  it('card 是 Link,href 指向 /repos/<name>', async () => {
    await renderReposList()
    const card = screen.getByTestId('repo-card-refund-service')
    const link = card.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/repos/refund-service')
  })
})

describe('/repos 列表页 · 客户端搜索过滤', () => {
  it('输入文字过滤 name / gitUrl / description,匹配项保留', async () => {
    await renderReposList()
    const search = screen.getByTestId('repos-page-search') as HTMLInputElement

    fireEvent.change(search, { target: { value: '退款' } })
    expect(screen.getByTestId('repo-card-refund-service')).toBeInTheDocument()
    expect(screen.queryByTestId('repo-card-order-service')).toBeNull()

    fireEvent.change(search, { target: { value: 'order' } })
    expect(screen.getByTestId('repo-card-order-service')).toBeInTheDocument()
    expect(screen.queryByTestId('repo-card-refund-service')).toBeNull()

    fireEvent.change(search, { target: { value: 'git@github.com:co/member' } })
    expect(screen.getByTestId('repo-card-member-service')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByTestId('repo-card-refund-service')).toBeInTheDocument()
    expect(screen.getByTestId('repo-card-order-service')).toBeInTheDocument()
    expect(screen.getByTestId('repo-card-member-service')).toBeInTheDocument()
  })
})

describe('/repos 列表页 · 添加按钮', () => {
  it('点「+ 添加仓库」打开 AddRepoModal', async () => {
    await renderReposList()
    expect(screen.queryByTestId('add-repo-modal-mock')).toBeNull()
    fireEvent.click(screen.getByTestId('repos-page-add'))
    expect(screen.getByTestId('add-repo-modal-mock')).toBeInTheDocument()
  })

  it('AddRepoModal onAdded → 新 card 出现', async () => {
    await renderReposList()
    fireEvent.click(screen.getByTestId('repos-page-add'))
    // 触发 lastAddRepoProps.onAdded(模拟用户在弹层内提交成功)
    lastAddRepoProps.onAdded?.({
      name: 'new-svc',
      gitUrl: 'git@github.com:co/new.git',
      description: '新仓库',
    })
    await waitFor(() =>
      expect(screen.getByTestId('repo-card-new-svc')).toBeInTheDocument(),
    )
  })
})

describe('/repos 列表页 · hover 编辑 / 删除', () => {
  it('hover card → 显示「编辑」「删除」按钮,离开 → 消失', async () => {
    await renderReposList()
    const card = screen.getByTestId('repo-card-refund-service')
    expect(screen.queryByTestId('repo-card-edit-refund-service')).toBeNull()
    expect(screen.queryByTestId('repo-card-delete-refund-service')).toBeNull()

    fireEvent.mouseEnter(card)
    expect(screen.getByTestId('repo-card-edit-refund-service')).toBeInTheDocument()
    expect(screen.getByTestId('repo-card-delete-refund-service')).toBeInTheDocument()

    fireEvent.mouseLeave(card)
    expect(screen.queryByTestId('repo-card-edit-refund-service')).toBeNull()
  })

  it('点删除 → 打开 DeleteRepoDialog,带 repo + usageCount', async () => {
    await renderReposList()
    const card = screen.getByTestId('repo-card-refund-service')
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTestId('repo-card-delete-refund-service'))

    expect(screen.getByTestId('delete-repo-dialog-mock')).toBeInTheDocument()
    expect(screen.getByTestId('delete-repo-dialog-target').textContent).toBe('refund-service')
    expect(lastDeleteRepoProps.usageCount).toBe(2)
  })

  it('确认删除 → 调 deleteRepo(force=true) + 卡片消失', async () => {
    await renderReposList()
    const card = screen.getByTestId('repo-card-member-service')
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTestId('repo-card-delete-member-service'))
    fireEvent.click(screen.getByTestId('delete-repo-dialog-confirm'))

    await waitFor(() =>
      expect(mockDeleteRepo).toHaveBeenCalledWith(
        'member-service',
        expect.objectContaining({ force: true }),
      ),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('repo-card-member-service')).toBeNull(),
    )
  })

  it('取消删除 → 不调 deleteRepo', async () => {
    await renderReposList()
    fireEvent.mouseEnter(screen.getByTestId('repo-card-refund-service'))
    fireEvent.click(screen.getByTestId('repo-card-delete-refund-service'))
    fireEvent.click(screen.getByTestId('delete-repo-dialog-cancel'))
    expect(mockDeleteRepo).not.toHaveBeenCalled()
    expect(screen.getByTestId('repo-card-refund-service')).toBeInTheDocument()
  })

  it('deleteRepo 失败 → 卡片仍在(可重试)', async () => {
    mockDeleteRepo.mockRejectedValueOnce(new Error('boom'))
    await renderReposList()
    fireEvent.mouseEnter(screen.getByTestId('repo-card-member-service'))
    fireEvent.click(screen.getByTestId('repo-card-delete-member-service'))
    fireEvent.click(screen.getByTestId('delete-repo-dialog-confirm'))

    await waitFor(() => expect(mockDeleteRepo).toHaveBeenCalled())
    // 失败时卡片应该保留
    expect(screen.getByTestId('repo-card-member-service')).toBeInTheDocument()
  })
})
