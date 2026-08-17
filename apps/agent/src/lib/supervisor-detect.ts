/**
 * supervisor 检测启发式(ADR-0037 D4 / issue 04)
 *
 * 用于在 agent 启动时提醒用户:如果当前进程不是被 supervisor 拉起的(裸跑
 * `node src/server.ts`),那么 `POST /api/agent/restart` 不会自动拉起新进程,
 * 用户必须手动重启。
 *
 * 启发式策略(从最可信到最不可信):
 *  1. `TSX_WATCH=1` —— `pnpm dev` = `tsx watch`,这是 AI-DevSpace 本地默认
 *  2. 父进程命令行(`process.ppid` + `ps`/`wmic`)含 `tsx` / `npm` / `pm2` / `docker`
 *  3. `PM2_HOME` / `PM2` 环境变量存在 —— pm2 拉起的子进程
 *  4. `KUBERNETES_SERVICE_HOST` —— K8s pod
 *  5. `FORWARDED_BY_DOCKER` 等自定 env
 *
 * 仅 console.warn,**不阻断启动**(决策 24「克制在场」)。
 */
export interface SupervisorDetection {
  supervised: boolean
  hint: string | null
}

/**
 * 同步 + 跨平台可用版本(纯 env / process 检查,不依赖 `ps`)。
 *
 * `getParentProcessName()` 是可选插件点(测试可注入 fake parent name);
 * 默认实现里,父进程名只在非 win32 下可读 /proc,Win 下退化到「单凭 env 判断」。
 */
export function detectSupervisor(parentProcessName?: string): SupervisorDetection {
  // 1. TSX_WATCH —— pnpm dev
  if (process.env.TSX_WATCH === '1') {
    return {
      supervised: true,
      hint: 'tsx watch(本地开发模式)',
    }
  }
  // 2. PM2
  if (process.env.PM2_HOME || process.env.PM2 || process.env.pm2_home) {
    return {
      supervised: true,
      hint: 'pm2',
    }
  }
  // 3. K8s pod
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return {
      supervised: true,
      hint: 'kubernetes',
    }
  }
  // 4. Docker 容器 —— 容器内通常 `KUBERNETES_SERVICE_HOST` 不存在,但有 docker 痕迹
  // (DOTNET_RUNNING_IN_CONTAINER / DOCKER_CONTAINER 等,这里只信最稳的两个)
  // 不主动加,避免误报;由父进程名启发式覆盖

  // 5. 父进程命令行启发式 —— Win 下通常读不到 /proc,落到「可能未 supervise」
  const name = (parentProcessName ?? '').toLowerCase()
  if (name.length > 0) {
    for (const marker of ['tsx', 'nodemon', 'pm2', 'node-foreman', 'forever']) {
      if (name.includes(marker)) {
        return {
          supervised: true,
          hint: marker,
        }
      }
    }
  }

  return {
    supervised: false,
    hint: '当前未在 supervisor(tsx watch / pm2 / k8s)下运行,POST /api/agent/restart 不会自动拉起新进程,需手动重启',
  }
}