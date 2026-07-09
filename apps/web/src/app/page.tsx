import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="p-6 font-sans">
      <h1 className="text-2xl font-bold text-red-500">AI-DevSpace</h1>
      <p className="mt-2 text-sm text-gray-600">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
    </main>
  );
}