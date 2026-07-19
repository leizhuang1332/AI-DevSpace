/**
 * ticket 03 测试 helper —— `FileReader` mock
 *
 * jsdom 没有实现 `FileReader.readAsDataURL`,导致 `requirement-upload.ts` 的
 * `fileToBase64()` 永远不 resolve。标准化一个最小 mock:
 * - readAsArrayBuffer → 0 字节 Uint8Array(validateUpload 闸门已通过 size 检查)
 * - readAsDataURL   → `data:application/octet-stream;base64,<btoa(filename)>`
 *                     (够用,关键是不被 magic bytes 闸门当 docx 拒绝 —— 文件名
 *                     base64 后前 4 字节不是 `PK\x03\x04`)
 *
 * 用法:在 ticket 03 上传相关测试的 `beforeEach` 装上,`afterEach` 不用管,
 * 后续测试可以重新装回实现版。
 *
 * 抽到这里避免 drafting-pane-upload / new-requirement-modal-upload 两个测试
 * 文件字面照抄同一个 class(standards axis review finding #2)。
 */

export class MockFileReader {
  public onload: ((e: ProgressEvent<FileReader>) => void) | null = null
  public onerror: ((e: ProgressEvent<FileReader>) => void) | null = null
  public result: string | ArrayBuffer | null = null

  readAsArrayBuffer(_file: File | Blob): void {
    this.result = new ArrayBuffer(0)
    this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>)
  }

  readAsDataURL(file: File | Blob): void {
    this.result = `data:application/octet-stream;base64,${btoa(
      file instanceof File ? file.name : 'mock',
    )}`
    this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>)
  }
}

/** 把 MockFileReader 装到 globalThis(FileReader 在浏览器 / jsdom 共享) */
export function installMockFileReader(): void {
  ;(globalThis as unknown as { FileReader: typeof MockFileReader }).FileReader =
    MockFileReader as unknown as typeof FileReader
}