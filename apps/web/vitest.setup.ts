import '@testing-library/jest-dom/vitest'

// ---------------------------------------------------------------------------
// window.matchMedia 桩(ticket 05 · useMediaQuery 必需)
// ---------------------------------------------------------------------------
// jsdom 不实现 matchMedia。`useMediaQuery` 在 jsdom 下若不桩,会走 typeof 检查
// 直接返回 false → 等价于"窄视口",会让现有 desktop 形态测试拿到 false 假设。
// 这里默认桩成 `(min-width: 1024px) === true`(桌面形态,等同 ≥ 1024px);
// 涉及窄视口的测试用 `setMatchMedia(false)` 单独切。
// ---------------------------------------------------------------------------

interface MediaQueryListStub {
  matches: boolean
  media: string
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null
  addListener: (cb: (ev: MediaQueryListEvent) => void) => void
  removeListener: (cb: (ev: MediaQueryListEvent) => void) => void
  addEventListener: (type: 'change', cb: (ev: MediaQueryListEvent) => void) => void
  removeEventListener: (
    type: 'change',
    cb: (ev: MediaQueryListEvent) => void,
  ) => void
  dispatchEvent: (ev: Event) => boolean
}

const defaultMatcher = (query: string): boolean => {
  // 桌面形态(min-width: 1024px)命中;其它 query 默认 false。
  const match = query.match(/\(min-width:\s*(\d+)px\)/)
  if (!match) return false
  // jsdom 默认 innerWidth=1024;若 query 为 min-width:1024 → 命中(>=)
  return 1024 >= Number(match[1])
}

// 维护一个全局"当前 query → 是否匹配"的 map,允许测试覆盖。
// 工具函数挂在 window 上,测试可直接调用。
const matchers = new Map<string, boolean>()

declare global {
  // eslint-disable-next-line no-var
  var setMatchMedia: (query: string, value: boolean) => void
  // eslint-disable-next-line no-var
  var resetMatchMedia: () => void
}

function build(query: string): MediaQueryList {
  const matches = matchers.has(query) ? (matchers.get(query) as boolean) : defaultMatcher(query)
  const mql: MediaQueryListStub = {
    matches,
    media: query,
    onchange: null,
    addListener: () => {
      /* no-op */
    },
    removeListener: () => {
      /* no-op */
    },
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    dispatchEvent: () => false,
  }
  return mql as unknown as MediaQueryList
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => build(query),
  })
}

// 暴露给测试:用 globalThis 避免 SSR 'window is undefined' 警告
globalThis.setMatchMedia = (query: string, value: boolean): void => {
  matchers.set(query, value)
}
globalThis.resetMatchMedia = (): void => {
  matchers.clear()
}

// ---------------------------------------------------------------------------
// ResizeObserver 桩(ticket 07 · ADR-0018 D2)
// ---------------------------------------------------------------------------
// jsdom 不实现 ResizeObserver;CitationOverlay 的 useEffect 当前不直接实例化
// ResizeObserver(只用 MutationObserver + window resize + container scroll),但
// 为后续可能的扩展 + 测试环境一致性,这里桩为 no-op。MutationObserver jsdom
// 自带实现,无需桩。
// ---------------------------------------------------------------------------

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = ResizeObserverStub
}

// ---------------------------------------------------------------------------
// requestAnimationFrame 桩(ticket 07)
// ---------------------------------------------------------------------------
// jsdom 不实现 rAF;CitationOverlay 的 rAF throttle 重排需要它。
// 桩实现:setTimeout(cb, 0) 等价行为 —— 测试推进 fake timer 或真 setTimeout 即可触发。
// ---------------------------------------------------------------------------

if (typeof globalThis.requestAnimationFrame !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).cancelAnimationFrame = (id: number): void => {
    clearTimeout(id)
  }
}
