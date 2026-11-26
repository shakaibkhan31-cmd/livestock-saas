export default function FinancesLoading() {
  return (
    <div className="min-h-screen bg-slate-50 py-8 sm:py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 animate-pulse">
        {/* Top Header Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="h-5 w-48 bg-slate-200 rounded-full" />
            <div className="h-8 w-64 bg-slate-200 rounded-xl" />
            <div className="h-4 w-80 max-w-full bg-slate-200 rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-10 w-36 bg-slate-200 rounded-xl" />
            <div className="h-10 w-44 bg-slate-200 rounded-xl" />
          </div>
        </div>

        {/* Tabs Skeleton */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
          <div className="h-9 w-28 bg-slate-200 rounded-t-xl" />
          <div className="h-9 w-24 bg-slate-200 rounded-t-xl" />
          <div className="h-9 w-32 bg-slate-200 rounded-t-xl" />
          <div className="h-9 w-32 bg-slate-200 rounded-t-xl" />
        </div>

        {/* Summary Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
          <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
          <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
          <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
        </div>

        {/* Main Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-64 bg-white rounded-2xl border border-slate-200 p-6" />
          <div className="h-64 bg-white rounded-2xl border border-slate-200 p-6" />
        </div>
      </div>
    </div>
  )
}