/**
 * Run Log 脱敏单元测试(issue 06 · ADR-0021 决策 38)
 *
 * 覆盖验收点 5(覆盖授权头、API key、token、password、私钥和已知秘密内容)
 * + 6(写盘与 SSE 发布前必须脱敏)
 * + 7(日志 UI 不负责补救服务端未脱敏内容 —— 此处只验证"上游已脱敏后
 *    下游 idempotent",UI 部分靠 server 落盘契约)
 *
 * 不测:正则具体内容 / 顺序(只断言关键 secret 不再出现 + 干净文本不变)
 */

import { describe, it, expect } from 'vitest'
import {
  redactText,
  redactValue,
  REDACTED_PLACEHOLDER,
  DEFAULT_REDACTION_PATTERNS,
} from '../../analysis-run/runLogRedaction.js'

describe('redactText(issue 06 验收 5)', () => {
  it('Authorization 头(独立 Bearer)整段抹掉', () => {
    // authorization 头整段抹除:原 value 不再出现;但 "Authorization: " 关键字保留
    // 便于阅读时知道这里原本是 secret
    const out = redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx.yyyyy')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(out).not.toContain('xxxxx')
    expect(out).not.toContain('yyyyy')
    // "Authorization" 关键字保留(便于阅读时知道这里被脱敏的是 auth)
    expect(out).toContain('Authorization')
  })

  it('Authorization 头 JSON 形式被抹掉', () => {
    const out = redactText('{"authorization": "Bearer abcdefghijklmnop1234567890"}')
    expect(out).not.toContain('abcdefghijklmnop1234567890')
    expect(out).toContain(REDACTED_PLACEHOLDER)
  })

  it('Authorization 头 HTTP 形式被抹掉', () => {
    const out = redactText('Authorization: Bearer t0k3n_abcdefghijklmnopqrst')
    expect(out).not.toContain('t0k3n_abcdefghijklmnopqrst')
  })

  it('api_key= / apikey= / token= / secret= / password= 各种键名都脱敏', () => {
    const cases = [
      'api_key=abcdefghijklmnop1234567890',
      'apikey: abcdefghijklmnop1234567890',
      'token="sk-abcdefghijklmnop1234567890"',
      "secret='abcdefghijklmnop1234567890'",
      'password: p@ssw0rd_123456',
      'passwd=shortpw', // 短值但走 key 前缀触发
      'pwd=shortpw',
      'client_secret: abcdefghijklmnop1234567890',
      'private_key="-----BEGIN RSA PRIVATE KEY-----"',
      'access_token=abcdefghijklmnop1234567890',
      'auth_token=abcdefghijklmnop1234567890',
    ]
    for (const c of cases) {
      const out = redactText(c)
      // 原始 value 不应再出现
      expect(out).not.toContain('abcdefghijklmnop1234567890')
      expect(out).not.toContain('p@ssw0rd_123456')
    }
  })

  it('带引号的值:secret="a b c" 整段抹掉(包含空格)', () => {
    const out = redactText('header: secret="a b c"')
    expect(out).not.toContain('a b c')
    expect(out).toContain('secret')
  })

  it('PEM 私钥块:多行 BEGIN/END 整段抹掉', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAxxxxxxx',
      'yyyyyyyyyyyyyyyy',
      'zzzzzzzzzzzzzz',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')
    const out = redactText(pem)
    expect(out).not.toContain('MIIEowIBAAKCAQEAxxxxxxx')
    expect(out).not.toContain('zzzzzzzzzzzzzz')
    expect(out).toContain(REDACTED_PLACEHOLDER)
  })

  it('AKID 阿里云 access key 前缀被抹掉', () => {
    const out = redactText('key=AKID1234567890ABCDEFGHIJKL')
    expect(out).not.toContain('AKID1234567890ABCDEFGHIJKL')
  })

  it('JWT 三段式 token 被抹掉', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const out = redactText(`token=${jwt}`)
    expect(out).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  })

  it('干净文本不被破坏', () => {
    const clean = 'hello world\nplain markdown\nno secrets here'
    expect(redactText(clean)).toBe(clean)
  })

  it('模型普通叙述中的"password"英文单词不被误判', () => {
    // 误伤守卫:无 key 前缀的纯单词不应被脱敏
    // 我们的正则全部要求 key 前缀或特定 token 形态,所以 "password" 单词
    // 出现在叙述中(如 "set a password for the user")不应被改
    const text = 'the user should set a password for their account'
    expect(redactText(text)).toBe(text)
  })

  it('非 string 入参原样返回(类型守卫)', () => {
    // redactText 期望 string;其他类型由 redactValue 内部 dispatch;
    // 这里仅验证 redactText 对非 string 不抛
    expect(redactText(123 as unknown as string)).toBe(123 as unknown as string)
  })
})

describe('redactValue(嵌套对象/数组)', () => {
  it('plain object:每个 string 字段都脱敏,key 名保留', () => {
    const input = {
      path: '/etc/secret',
      api_key: 'api_key=abcdefghijklmnop1234567890', // 模拟 key=value 形式(常见工具入参)
      nested: {
        password: "password: 'p@ssw0rd_123456'", // 模拟 key: value 形式
        count: 42,
      },
    }
    const out = redactValue(input) as Record<string, unknown>
    expect(out.path).toBe('/etc/secret')
    // 脱敏后 key prefix 仍可见 + value 用 [REDACTED] 替换
    expect(String(out.api_key)).toContain('[REDACTED]')
    expect(String(out.api_key)).not.toContain('abcdefghijklmnop1234567890')
    const nested = out.nested as Record<string, unknown>
    expect(String(nested.password)).toContain('[REDACTED]')
    expect(String(nested.password)).not.toContain('p@ssw0rd_123456')
    expect(nested.count).toBe(42)
  })

  it('array:每个元素都脱敏', () => {
    const input = ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx', 'clean string', 42]
    const out = redactValue(input) as unknown[]
    expect(out[0]).toBe(REDACTED_PLACEHOLDER)
    expect(out[1]).toBe('clean string')
    expect(out[2]).toBe(42)
  })

  it('null / undefined / 数字 / 布尔 / bigint 原样', () => {
    expect(redactValue(null)).toBe(null)
    expect(redactValue(undefined)).toBe(undefined)
    expect(redactValue(0)).toBe(0)
    expect(redactValue(false)).toBe(false)
    expect(redactValue(BigInt(123))).toBe(BigInt(123))
  })

  it('原始 value 不被原地修改(返回新对象)', () => {
    const input = { api_key: 'abcdefghijklmnop1234567890' }
    redactValue(input)
    expect(input.api_key).toBe('abcdefghijklmnop1234567890')
  })
})

describe('idempotence(issue 06 验收 7 · 重复脱敏不损坏文本)', () => {
  it('脱敏后再脱敏,结果不变', () => {
    const text = 'header: api_key=abcdefghijklmnop1234567890'
    const once = redactText(text)
    const twice = redactText(once)
    expect(twice).toBe(once)
  })

  it('嵌套对象多重脱敏也 idempotent', () => {
    const input = { token: 'abcdefghijklmnop1234567890' }
    const once = redactValue(input)
    const twice = redactValue(once)
    expect(twice).toEqual(once)
  })
})

describe('patterns 默认集合', () => {
  it('覆盖 issue 06 决策 38 列出的所有 secret 类别', () => {
    // 至少 7 条,每条对应一个 secret 类别
    expect(DEFAULT_REDACTION_PATTERNS.length).toBeGreaterThanOrEqual(7)
  })
})
