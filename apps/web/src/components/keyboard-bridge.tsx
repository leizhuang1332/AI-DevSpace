'use client';
// Task 9: 升级 KeyboardBridge → re-export UIOverlayProvider 以保持 Task 2 import 路径仍 resolve
// 真实键盘监听 + 弹窗 state 现由 ui-overlay-store 中的 UIOverlayProvider 接管。
// (workspace)/layout.tsx 直接 wrap UIOverlayProvider; 旧 KeyboardBridge usage 仍指向同一个 Provider。
export { UIOverlayProvider as KeyboardBridge } from './ui-overlay-store';