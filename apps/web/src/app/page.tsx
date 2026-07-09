import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white p-6 font-sans text-gray-900">
      <h1 className="text-3xl font-bold">AI-DevSpace</h1>
      <p className="mt-4 text-base text-gray-600">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
      <div className="mt-6 flex gap-2">
        <span className="rounded-md bg-blue-500 px-3 py-2 text-sm text-white">p-2/3</span>
        <span className="rounded-xl bg-emerald-500 px-4 py-2 text-base text-white">p-4/2</span>
        <span className="rounded-sm bg-rose-500 px-12 py-3 text-2xl text-white">p-12/3</span>
      </div>
    </main>
  );
}
