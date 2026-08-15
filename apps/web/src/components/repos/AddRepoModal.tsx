'use client'

/**
 * AddRepoModal —— `/repos` 列表页「+ 添加仓库」弹层
 *
 * issue 07 / ADR-0030 D6+D8(决策 Q5):
 * - 调 POST /api/repos {name, gitUrl, description}
 * - 后端必跑 git ls-remote --heads <gitUrl> 验证可达 + 凭据可用
 * - ls-remote 通常 5-10s,提交期文案变「正在验证可达…」
 * - name 必须文件名安全(也作为 requirements/<id>/codebase/<name>/ 目录名)
 *
 * name 校验规则:`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`
 * - 首字符必须字母数字(避免 . / _ 开头)
 * - 后续字符只允许字母数字 / . / _ / -
 * - 与 ADR-0030 D1「name 即标识,文件名安全」一致
 */

import { useEffect, useState } from 'react'
import { AgentError } from '@/lib/agent-client'
import { createRepo, type RepoRegistryEntry } from '@/lib/repo-attach'

export interface AddRepoModalProps {
  open: boolean
  onClose: () => void
  onAdded: (entry: RepoRegistryEntry) => void
}

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/

function validateName(name: string): string | null {
  if (name.length === 0) return null // 空值不报错(disabled 提交即可)
  if (!NAME_REGEX.test(name)) {
    return 'name 仅允许合法字符(字母数字、.、_、-,且必须以字母数字开头)'
  }
  return null
}

/**
 * 把后端 AgentError 翻译成用户可见文案。
 *
 * - E_AUTH → 「git ls-remote 鉴权失败,请检查 SSH / HTTPS 凭据」
 * - E_NETWORK → 「git ls-remote 网络不可达,请检查网络」
 * - E_TIMEOUT → 「git ls-remote 超时,请稍后重试」
 * - E_REPO_NAME_EXISTS → 「该 name 已被占用,请换一个」
 * - 其他 → 直接展示后端 message
 */
function translateError(err: unknown): string {
  if (err instanceof AgentError) {
    const code = (err.body as { error?: string } | null)?.error
    const message = (err.body as { message?: string } | null)?.message
    switch (code) {
      case 'E_AUTH':
        return 'git ls-remote 鉴权失败,请检查 SSH / HTTPS 凭据'
      case 'E_NETWORK':
        return 'git ls-remote 网络不可达,请检查网络'
      case 'E_TIMEOUT':
        return 'git ls-remote 超时,请稍后重试'
      case 'E_REPO_NAME_EXISTS':
        return '该 name 已被占用,请换一个'
      default:
        return message ? `${code ?? '添加失败'}:${message}` : `添加失败(${err.status})`
    }
  }
  if (err instanceof Error) return err.message
  return '未知错误'
}

export function AddRepoModal({ open, onClose, onAdded }: AddRepoModalProps) {
  const [name, setName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开重置表单 + 清错误
  useEffect(() => {
    if (open) {
      setName('')
      setGitUrl('')
      setDescription('')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  if (!open) return null

  const nameError = validateName(name)
  const canSubmit =
    !submitting &&
    name.trim().length > 0 &&
    gitUrl.trim().length > 0 &&
    nameError === null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const entry = await createRepo({
        name: name.trim(),
        gitUrl: gitUrl.trim(),
        description: description.trim(),
      })
      onAdded(entry)
      onClose()
    } catch (err) {
      setError(translateError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="add-repo-modal"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        data-testid="add-repo-modal-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-1">添加仓库</h2>
            <button
              type="button"
              data-testid="add-repo-modal-close"
              onClick={onClose}
              className="text-text-3 hover:text-text-1 text-lg leading-none"
              aria-label="关闭"
            >
              ✕
            </button>
          </header>

          {/* name */}
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">仓库名 *</span>
            <input
              type="text"
              data-testid="add-repo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="refund-service"
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 font-mono focus:outline-none focus:border-brand"
            />
            <span className="text-xs text-text-3">
              全局唯一标识,字母数字 + . _ -,以字母数字开头
            </span>
            {nameError && (
              <span
                data-testid="add-repo-name-error"
                className="text-xs text-error"
              >
                {nameError}
              </span>
            )}
          </label>

          {/* gitUrl */}
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">Git URL *</span>
            <input
              type="text"
              data-testid="add-repo-giturl"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="git@github.com:company/repo.git"
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 font-mono focus:outline-none focus:border-brand"
            />
            <span className="text-xs text-text-3">
              提交后会跑 ls-remote 验证可达 + 凭据可用(5-10s)
            </span>
          </label>

          {/* description */}
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">描述(可选)</span>
            <input
              type="text"
              data-testid="add-repo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="退款核心服务"
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
            />
          </label>

          {/* 错误提示 */}
          {error && (
            <div
              data-testid="add-repo-error"
              className="text-sm text-error bg-error/10 px-3 py-2 rounded-md"
            >
              {error}
            </div>
          )}

          {/* 操作 */}
          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="add-repo-cancel"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="add-repo-submit"
              disabled={!canSubmit}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '正在验证可达…' : '添加'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
