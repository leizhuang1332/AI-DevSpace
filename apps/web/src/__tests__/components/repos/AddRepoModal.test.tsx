/**
 * AddRepoModal 组件测试 — issue 07 / ADR-0030 D6+D8
 *
 * 验收:
 * - open=false → 不渲染
 * - open=true → 渲染表单(name / gitUrl / description)
 * - name 空 → 提交按钮 disabled;gitUrl 空 → 提交按钮 disabled
 * - 提交 → 调 POST /api/repos {name, gitUrl, description};成功后 onAdded + onClose
 * - name 校验:`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`(文件名安全 + 不以 . / _ 开头)
 * - 提交期 ls-remote 跑 ~5-10s,文案变「正在验证可达…」
 * - 后端错 → 显示错误文案 + 不关闭
 *
 * mock:vi.mock '@/lib/repo-attach' 的 addRepoToRegistry,控制 success / error 状态。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AddRepoModal } from '@/components/repos/AddRepoModal'
import { AgentError } from '@/lib/agent-client'

// ---- 受控 mock:createRepo ----
const mockCreate = vi.fn()
let mockPromise: Promise<unknown> = Promise.resolve({
  name: 'refund-service',
  gitUrl: 'git@github.com:co/refund.git',
  description: '退款',
})

vi.mock('@/lib/repo-attach', () => ({
  createRepo: (...args: unknown[]) => {
    mockCreate(...args)
    return mockPromise
  },
}))

afterEach(() => {
  cleanup()
  mockCreate.mockClear()
  mockPromise = Promise.resolve({
    name: 'refund-service',
    gitUrl: 'git@github.com:co/refund.git',
    description: '退款',
  })
})

function renderModal(
  props: Partial<React.ComponentProps<typeof AddRepoModal>> = {},
) {
  return render(
    <AddRepoModal
      open={true}
      onClose={vi.fn()}
      onAdded={vi.fn()}
      {...props}
    />,
  )
}

describe('AddRepoModal · 开关', () => {
  it('open=false → 不渲染', () => {
    renderModal({ open: false })
    expect(screen.queryByTestId('add-repo-modal')).toBeNull()
  })

  it('open=true → 渲染表单字段(name / gitUrl / description)', () => {
    renderModal({ open: true })
    expect(screen.getByTestId('add-repo-modal')).toBeInTheDocument()
    expect(screen.getByTestId('add-repo-name')).toBeInTheDocument()
    expect(screen.getByTestId('add-repo-giturl')).toBeInTheDocument()
    expect(screen.getByTestId('add-repo-description')).toBeInTheDocument()
    expect(screen.getByTestId('add-repo-submit')).toBeInTheDocument()
  })
})

describe('AddRepoModal · 表单校验', () => {
  it('name 空 → 提交按钮 disabled', () => {
    renderModal()
    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('gitUrl 空 → 提交按钮 disabled', () => {
    renderModal()
    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'refund-service' },
    })
    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('name 含非法字符(/、空格、中文)→ 校验失败文案 + 提交按钮 disabled', () => {
    renderModal()
    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'bad name!' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/x.git' },
    })
    const err = screen.getByTestId('add-repo-name-error')
    expect(err.textContent).toContain('合法字符')
    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('name 以 . 或 _ 开头 → 校验失败', () => {
    renderModal()
    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: '.hidden' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/x.git' },
    })
    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('合法 name + gitUrl → 提交按钮 enabled', () => {
    renderModal()
    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'refund-service' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/refund.git' },
    })
    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })
})

describe('AddRepoModal · 提交', () => {
  it('合法表单 → createRepo 调用 + onAdded + onClose', async () => {
    const onClose = vi.fn()
    const onAdded = vi.fn()
    renderModal({ onClose, onAdded })

    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'refund-service' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/refund.git' },
    })
    fireEvent.change(screen.getByTestId('add-repo-description'), {
      target: { value: '退款' },
    })
    fireEvent.click(screen.getByTestId('add-repo-submit'))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledOnce())
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund.git',
      description: '退款',
    })
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('提交期间 → 文案「正在验证可达…」+ 按钮 disabled(ls-remote 5-10s loading)', async () => {
    // pending 状态:createRepo 不立即 resolve
    let resolve!: (v: unknown) => void
    mockPromise = new Promise((r) => { resolve = r })
    renderModal()

    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'a' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@b' },
    })
    fireEvent.click(screen.getByTestId('add-repo-submit'))

    const submit = screen.getByTestId('add-repo-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('正在验证可达')

    // resolve 让 promise 完成,避免测试泄漏
    resolve({ name: 'a', gitUrl: 'git@b', description: '' })
  })

  it('后端报错 → 显示错误文案 + 不关闭', async () => {
    mockPromise = Promise.reject(
      new AgentError(409, {
        error: 'E_REPO_NAME_EXISTS',
        message: '仓库名 refund-service 已存在',
      }),
    )
    const onClose = vi.fn()
    renderModal({ onClose })

    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'refund-service' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/refund.git' },
    })
    fireEvent.click(screen.getByTestId('add-repo-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('add-repo-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('add-repo-error').textContent).toContain(
      '已被占用',
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('鉴权错(E_AUTH)→ 显示对应文案', async () => {
    mockPromise = Promise.reject(
      new AgentError(401, {
        error: 'E_AUTH',
        message: 'git ls-remote 鉴权失败',
      }),
    )
    renderModal()

    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'private' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@github.com:co/private.git' },
    })
    fireEvent.click(screen.getByTestId('add-repo-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('add-repo-error')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('add-repo-error').textContent).toContain('鉴权')
  })
})

describe('AddRepoModal · 关闭', () => {
  it('点遮罩 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('add-repo-modal'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点遮罩内面板 → 不关闭(stopPropagation)', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('add-repo-modal-panel'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点 ✕ → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('add-repo-modal-close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('点取消 → onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByTestId('add-repo-cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('提交期间 → 取消按钮也 disabled(防止 ls-remote 中途撤销)', async () => {
    let resolve!: (v: unknown) => void
    mockPromise = new Promise((r) => { resolve = r })
    renderModal()

    fireEvent.change(screen.getByTestId('add-repo-name'), {
      target: { value: 'a' },
    })
    fireEvent.change(screen.getByTestId('add-repo-giturl'), {
      target: { value: 'git@b' },
    })
    fireEvent.click(screen.getByTestId('add-repo-submit'))

    const cancel = screen.getByTestId('add-repo-cancel') as HTMLButtonElement
    expect(cancel.disabled).toBe(true)

    resolve({ name: 'a', gitUrl: 'git@b', description: '' })
  })
})
