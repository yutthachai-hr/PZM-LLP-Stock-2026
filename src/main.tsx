import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { completeLiffLoginIfReturning } from './share/liffBoot'
import { installErrorReporter } from './services/errorReporter'

// E4: uncaught errors to the Workers log (never Firestore). Off outside production builds.
installErrorReporter()

// Back from LINE Login? Let the LIFF SDK finish the exchange and put the URL back where the
// person was, before the router reads it. A no-op on every other load.
void completeLiffLoginIfReturning().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
