import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as selskapsanalyseBekreftelse } from './selskapsanalyse-bekreftelse'
import { template as selskapsanalyseAdminVarsel } from './selskapsanalyse-admin-varsel'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'selskapsanalyse-bekreftelse': selskapsanalyseBekreftelse,
  'selskapsanalyse-admin-varsel': selskapsanalyseAdminVarsel,
}
