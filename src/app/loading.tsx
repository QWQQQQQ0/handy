export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-[13px] text-zinc-400">Loading...</span>
      </div>
    </div>
  );
}
