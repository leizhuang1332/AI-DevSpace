import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>AI-DevSpace</h1>
      <p>Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}</p>
    </main>
  );
}