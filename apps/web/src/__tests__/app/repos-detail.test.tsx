/**
 * /repos/[name] 详情页 client 组件测试 — issue 07 / ADR-0030 D6
 *
 * 验收:
 * - 顶部:Crumbs(仓库 / <name>)+ 标题 + gitUrl + 描述
 * - 「关联需求 (N)」section:列出每个 usage(reqId / branch / codebasePath)
 * - usage=[] → 「尚无需求关联此仓库」空态
 * - 注册表无此 name → notFound()(404) — RSC 处理
 *
 * page.tsx 是 RSC,负责 SSR 拉数据 + notFound 判定;
 * 本测试针对 client 组件 RepoDetailView。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// next/link 简化
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

const REPO = {
  name: 'refund-service',
  gitUrl: 'git@github.com:co/refund.git',
  description: '退款核心服务',
}
const USAGE = [
  { requirementId: 'req-001', branch: 'feat/refund', codebasePath: '/Users/x/.aidevspace/requirements/req-001/codebase/refund-service' },
  { requirementId: 'req-007', branch: 'feat/refund-v2', codebasePath: '/Users/x/.aidevspace/requirements/req-007/codebase/refund-service' },
]

afterEach(() => cleanup())

async function renderDetail(props: Partial<React.ComponentProps<typeof import('@/app/(workspace)/repos/[name]/RepoDetailView').RepoDetailView>> = {}) {
  const { RepoDetailView } = await import('@/app/(workspace)/repos/[name]/RepoDetailView')
  return render(<RepoDetailView repo={REPO} usage={USAGE} {...props} />)
}

describe('/repos/[name] 详情页 · 文案', () => {
  it('标题显示仓库名', async () => {
    await renderDetail()
    expect(screen.getByTestId('repo-detail-title').textContent).toContain(
      'refund-service',
    )
  })

  it('gitUrl 用 mono 字体显示', async () => {
    await renderDetail()
    const url = screen.getByTestId('repo-detail-giturl')
    expect(url.textContent).toBe('git@github.com:co/refund.git')
    expect(url.className).toContain('font-mono')
  })

  it('描述渲染', async () => {
    await renderDetail()
    expect(screen.getByTestId('repo-detail-description').textContent).toContain(
      '退款核心服务',
    )
  })

  it('Crumbs 含「仓库」 + 当前 name', async () => {
    await renderDetail()
    const crumbs = screen.getByTestId('repo-detail-crumbs')
    expect(crumbs.textContent).toContain('仓库')
    expect(crumbs.textContent).toContain('refund-service')
  })
})

describe('/repos/[name] 详情页 · 关联需求列表', () => {
  it('N>0 → 列出每条 usage(reqId / branch / codebasePath)', async () => {
    await renderDetail()
    expect(screen.getByTestId('repo-detail-usage-heading').textContent).toContain(
      '2',
    )
    expect(screen.getByTestId('repo-detail-usage-list')).toBeInTheDocument()

    // req-001 行
    const row1 = screen.getByTestId('repo-detail-usage-row-req-001')
    expect(row1.textContent).toContain('req-001')
    expect(row1.textContent).toContain('feat/refund')
    expect(row1.textContent).toContain(
      '/Users/x/.aidevspace/requirements/req-001/codebase/refund-service',
    )

    // reqId 是 Link,href → /requirements/req-001
    const link = row1.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/requirements/req-001')

    // req-007 行
    expect(
      screen.getByTestId('repo-detail-usage-row-req-007'),
    ).toBeInTheDocument()
  })

  it('N=0 → 空态文案「尚无需求关联此仓库」', async () => {
    await renderDetail({ usage: [] })
    expect(
      screen.getByTestId('repo-detail-usage-empty'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('repo-detail-usage-empty').textContent,
    ).toContain('尚无需求关联此仓库')
    expect(screen.queryByTestId('repo-detail-usage-list')).toBeNull()
  })

  it('meta.yaml 读不到 branch → branch 列显示「—」而不是空白', async () => {
    await renderDetail({
      usage: [
        {
          requirementId: 'req-broken',
          branch: '',
          codebasePath: '/tmp/broken',
        },
      ],
    })
    const row = screen.getByTestId('repo-detail-usage-row-req-broken')
    expect(row.textContent).toContain('—')
  })
})
