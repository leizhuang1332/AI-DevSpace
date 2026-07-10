import { settings, type GlobalSettings } from '@/app/(workspace)/data/mock';
import { ThemeSwitcher } from '@/components/theme-switcher';

const SIDE_NAV = [
  { key: 'appearance', label: '🎨 外观',         active: true  },
  { key: 'ai',         label: '🤖 AI 体验',      active: false },
  { key: 'workspace',  label: '📂 工作空间',     active: false },
  { key: 'agent',      label: '🔌 Agent 连接',   active: false },
  { key: 'shortcut',   label: '⌨️ 快捷键',       active: false },
  { key: 'push',       label: '🔔 推送',         active: false },
  { key: 'data',       label: '📦 数据 · 备份',  active: false },
  { key: 'danger',     label: '⚠️ 高级 · 重置',  active: false },
];

const TYPEWRITER_OPTIONS: { value: GlobalSettings['typewriterSpeed']; label: string }[] = [
  { value: 'off',    label: '关（即时）' },
  { value: 'fast',   label: '快 10ms'   },
  { value: 'medium', label: '中 20ms'   },
  { value: 'slow',   label: '慢 30ms'   },
];

const inputCls =
  'w-full max-w-[280px] px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]';

export default function SettingsPage() {
  return (
    <div className="grid grid-cols-[240px_1fr] min-h-[calc(100vh-72px)]">
      {/* Settings side nav */}
      <aside className="bg-bg-elevated border-r border-border p-4 overflow-auto">
        <h3 className="text-[11px] text-text-3 uppercase tracking-wider font-medium px-2 mb-2">
          设置
        </h3>
        {SIDE_NAV.map((item) => (
          <div
            key={item.key}
            className={`px-3 py-1.5 rounded-sm text-sm cursor-pointer mb-0.5 ${
              item.active
                ? 'bg-brand-50 text-brand-700 font-medium'
                : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'
            }`}
          >
            {item.label}
          </div>
        ))}
      </aside>

      <main className="p-6 lg:p-8 overflow-auto max-w-[920px]">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold">外观</h1>
          <div className="text-text-2 text-md mt-1">主题、字号、信息密度</div>
        </div>

        {/* Theme — 复用 ThemeSwitcher（Step 1） */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">主题</h2>
          <div className="text-sm text-text-3 mb-4">
            跟随系统 / 暗色 / 亮色（用户偏好：亮色为心智模型）
          </div>
          <ThemeSwitcher />
        </section>

        {/* Information density */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">信息密度</h2>
          <div className="text-sm text-text-3 mb-4">全局行高与元素间距（Linear 紧凑型为默认）</div>
          <Field label="列表行高">
            <Segmented options={['紧凑', '默认', '宽松']} activeIndex={1} />
          </Field>
          <Field label="字号档位">
            <Segmented options={['小', '中（13px）', '大']} activeIndex={1} />
          </Field>
        </section>

        {/* AI Experience */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">AI 体验</h2>
          <div className="text-sm text-text-3 mb-4">AI 输出、推送、行为</div>
          <Field label="打字机速度" desc="AI 流式文本的打字速度">
            <Segmented
              options={TYPEWRITER_OPTIONS.map((o) => o.label)}
              activeIndex={TYPEWRITER_OPTIONS.findIndex((o) => o.value === settings.typewriterSpeed)}
            />
          </Field>
          <Field label="AI 主动推送" desc="Skill 完成 / 提问 / 错误">
            <Toggle on={true} label="开启" />
          </Field>
          <Field label="静默窗口" desc="同类型事件 N 秒内不重复推">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                defaultValue={settings.silentWindowSeconds}
                className="w-20 max-w-none px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none focus:border-brand-500 focus:bg-bg-elevated"
              />
              <span className="text-text-3 text-sm ml-1.5">秒</span>
            </div>
          </Field>
        </section>

        {/* Agent connection */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">Agent 连接</h2>
          <div className="text-sm text-text-3 mb-4">Web 工作台 ↔ 本地 Agent 守护进程</div>
          <div className="flex items-center gap-3 p-3 bg-[#dcfce7] rounded-md text-sm text-[#166534] mb-4">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <div>
              <strong>已连接</strong> · Agent 端口 <code className="font-mono bg-white px-1.5 py-0.5 rounded-sm text-[#166534]">7777</code> · Web 端口 <code className="font-mono bg-white px-1.5 py-0.5 rounded-sm text-[#166534]">3333</code>
            </div>
            <span className="flex-1" />
            <button className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium">
              查看日志
            </button>
            <span className="h-6 px-2.5 rounded-md bg-white border border-[#86efac] text-[#166534] text-xs flex items-center font-medium">
              ● 健康
            </span>
          </div>
          <Field label="Agent 端点">
            <input
              defaultValue={settings.agentEndpoint}
              className={`${inputCls} font-mono max-w-none`}
            />
          </Field>
          <Field label="鉴权 Token" desc="写入 ~/.aidevspace/config.yaml">
            <div className="flex items-center gap-2">
              <input
                type="password"
                defaultValue="••••••••••••••••"
                className={`${inputCls} font-mono max-w-[280px]`}
              />
              <button className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium ml-2">
                重置
              </button>
            </div>
          </Field>
        </section>

        {/* Workspace */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">工作空间</h2>
          <div className="text-sm text-text-3 mb-4">~/.aidevspace/ 目录的物理位置</div>
          <Field label="工作空间根">
            <input
              defaultValue={settings.workspaceRoot}
              className={`${inputCls} font-mono max-w-none`}
            />
          </Field>
          <Field label="磁盘占用">
            <div className="text-sm text-text-2">
              <strong>{settings.diskUsage}</strong>
            </div>
          </Field>
        </section>

        {/* Danger zone */}
        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">危险操作</h2>
          <div className="text-sm text-text-3 mb-4">备份、迁移、卸载</div>
          <Field label="打包工作空间" desc="生成 aidevspace-backup-YYYYMMDD.tar.gz">
            <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">
              ⤓ 下载备份
            </button>
          </Field>
          <Field label="完全卸载" desc="删除 ~/.aidevspace/ 目录 + 停止 Agent 进程">
            <button className="h-7 px-3 bg-[#fef2f2] text-error border border-[#fecaca] rounded-md text-sm font-medium">
              卸载 AI DevSpace
            </button>
          </Field>
        </section>

        <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明：</strong>全局设置 = 影响整个工作台的偏好（区别于 07 需求设置的单需求粒度）。
          所有改动立即写入 <code className="font-mono">~/.aidevspace/config.yaml</code>，下次会话自动加载。
          Agent 连接健康度 = 心跳 + 健康检查（HTTP GET /api/agent/status），Agent 进程崩溃时 Web 自动 Toast + 弹窗引导重启。
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border first:border-t-0">
      <div>
        <div className="text-sm font-medium text-text-1">{label}</div>
        {desc && <div className="text-xs text-text-3 mt-0.5">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Segmented({ options, activeIndex }: { options: string[]; activeIndex: number }) {
  return (
    <div className="inline-flex bg-bg-subtle rounded-md p-0.5 gap-0.5">
      {options.map((opt, i) => (
        <button
          key={opt}
          className={`px-3 py-1.5 rounded-sm text-sm ${
            i === activeIndex
              ? 'bg-bg-elevated text-text-1 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
              : 'text-text-2'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={`inline-flex items-center gap-2 cursor-pointer ${on ? 'toggle on' : 'toggle'}`}>
      <span
        className={`relative w-8 h-[18px] rounded-full transition-colors ${
          on ? 'bg-brand-500' : 'bg-border-strong'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 w-[14px] h-[14px] bg-white rounded-full transition-transform ${
            on ? 'translate-x-[14px]' : ''
          }`}
        />
      </span>
      <span className="text-sm text-text-1">{label}</span>
    </div>
  );
}