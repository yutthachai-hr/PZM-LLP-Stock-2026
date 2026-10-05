import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { I18nProvider } from '../i18n/I18nContext'
import { SupplierConfirmPage } from './SupplierConfirmPage'

// The supplier's page (/s/<token>): its own small bundle — no Firebase, no sign-in, no
// service worker — so it opens fast in LINE's in-app browser on a supplier's phone.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SupplierConfirmPage />
    </I18nProvider>
  </StrictMode>,
)
