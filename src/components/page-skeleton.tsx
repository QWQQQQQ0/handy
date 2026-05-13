export function PageSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0 fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-zinc-200 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">Loading...</span>
      </div>
    </div>
  );
}
