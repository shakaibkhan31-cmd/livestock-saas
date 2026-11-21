'use client'

export type ExportableTxn = {
  date: string
  type: 'Income' | 'Expense'
  category: string
  tagOrSpecies: string
  amount: number
  description: string
  source: 'global' | 'animal'
}

export default function FinancesExportButton({
  rows,
  fileName = 'farm-financial-ledger.csv',
}: {
  rows: ExportableTxn[]
  fileName?: string
}) {
  const handleDownloadCsv = () => {
    const headers = [
      'Date',
      'Type',
      'Category',
      'Tag / Species',
      'Amount (PKR)',
      'Signed Amount (PKR)',
      'Source',
      'Notes',
    ]

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '')
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const csvLines = [
      headers.join(','),
      ...rows.map(r => {
        const signed = r.type === 'Income' ? r.amount : -Math.abs(r.amount)
        return [
          escapeCsv(r.date),
          escapeCsv(r.type),
          escapeCsv(r.category),
          escapeCsv(r.tagOrSpecies),
          escapeCsv(r.amount),
          escapeCsv(signed),
          escapeCsv(r.source === 'animal' ? 'Animal Ledger' : 'Farm General'),
          escapeCsv(r.description),
        ].join(',')
      }),
    ]

    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', fileName)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={handleDownloadCsv}
      disabled={rows.length === 0}
      className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-medium rounded-xl shadow-sm transition text-sm inline-flex items-center gap-1.5"
    >
      <span>📥 Export CSV ({rows.length})</span>
    </button>
  )
}