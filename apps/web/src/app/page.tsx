import { SHARED_PACKAGE_OK } from '@ai-devspace/shared';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">AI-DevSpace</h1>
      <p className="mt-4 text-base text-muted-foreground">
        Step 1 OK — monorepo resolved, shared={String(SHARED_PACKAGE_OK)}
      </p>
      <div className="mt-6 flex gap-2">
        <span className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          primary
        </span>
        <span className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          secondary
        </span>
        <span className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          destructive
        </span>
      </div>
    </main>
  );
}