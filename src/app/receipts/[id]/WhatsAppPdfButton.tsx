'use client'

import { useState } from 'react'
import html2canvas from 'html2canvas-pro'
import { jsPDF } from 'jspdf'

interface WhatsAppPdfButtonProps {
  waNumber: string | null
  clientName: string
  farmName: string
  amountFormatted: string
  receiptNo: string
  receiptSelector?: string
}

export default function WhatsAppPdfButton({
  waNumber,
  clientName,
  farmName,
  amountFormatted,
  receiptNo,
  receiptSelector = '.receipt',
}: WhatsAppPdfButtonProps) {
  const [downloading, setDownloading] = useState(false)

  const handleDownloadAndWhatsApp = async () => {
    setDownloading(true)
    try {
      const receiptEl = document.querySelector(receiptSelector) as HTMLElement | null
      if (receiptEl) {
        const canvas = await html2canvas(receiptEl, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
        })
        const imgData = canvas.toDataURL('image/png')
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4',
        })
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
        const imgW = canvas.width * ratio
        const imgH = canvas.height * ratio
        const x = (pageWidth - imgW) / 2
        const y = (pageHeight - imgH) / 2

        pdf.addImage(imgData, 'PNG', x, y, imgW, imgH)
        const safeClient = clientName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Client'
        pdf.save(`Baa-Baa-Shed-Receipt-${receiptNo}-${safeClient}.pdf`)
      }

      const message =
        `Assalam-o-Alaikum *${clientName}*,\n\n` +
        `Shukriya! *${farmName}* ko aapki Palai payment *Rs. ${amountFormatted}* mosool ho gayi hai.\n` +
        `Receipt No: *${receiptNo}*\n` +
        `Receipt PDF attach kar di gayi hai.\n\nJazakAllah!`

      const whatsappUrl = `https://wa.me/${waNumber || ''}?text=${encodeURIComponent(message)}`
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownloadAndWhatsApp}
      disabled={downloading}
      title={
        waNumber
          ? `Download PDF & open WhatsApp for ${waNumber}`
          : 'Download PDF & open WhatsApp (contact wahan chunein)'
      }
      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold shadow transition cursor-pointer"
    >
      {downloading ? '⏳ Generating PDF...' : '📥 Download PDF & WhatsApp'}
    </button>
  )
}