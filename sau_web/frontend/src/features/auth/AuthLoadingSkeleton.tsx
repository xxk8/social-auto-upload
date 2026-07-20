export const AuthLoadingSkeleton = () => (
  <div className="flex min-h-screen items-center justify-center p-8">
    <div className="w-full max-w-md space-y-3">
      <div className="h-8 w-3/4 animate-pulse rounded-md bg-primary/10" />
      <div className="h-4 w-full animate-pulse rounded-md bg-primary/10" />
      <div className="h-4 w-5/6 animate-pulse rounded-md bg-primary/10" />
    </div>
  </div>
)
