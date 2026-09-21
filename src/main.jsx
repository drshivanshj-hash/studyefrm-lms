import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

// design kit foundations (order matters: tokens first), then app additions
import './styles/colors_and_type.css'
import './styles/kit.css'
import './styles/screens.css'
import './styles/screens2.css'
import './styles/auth.css'
import './index.css'

import { AuthProvider, useAuth } from './lib/auth'
import App from './App'
import Landing from './screens/Landing'
import ModuleReader from './screens/ModuleReader'
import AuthCallback from './screens/AuthCallback'
import AppHome, { Waitlist } from './screens/AppHome'
import CurriculumBrowser from './screens/CurriculumBrowser'
import DomainDetail from './screens/DomainDetail'
import LineView from './screens/LineView'
import OsceLibrary from './screens/OsceLibrary'

function Spinner() {
  return <div className="wrap authcb"><div className="ph"><div className="ph-s">Loading…</div></div></div>
}

// session required (status/role branching downstream)
function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/" replace />
  return children
}

// session + approved (or admin); a signed-in but pending user sees the waitlist
function RequireApproved({ children }) {
  const { session, loading, isApproved, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/" replace />
  if (!(isApproved || isAdmin)) return <Waitlist />
  return children
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Landing />} />
            <Route path="m/:slug" element={<ModuleReader />} />
            <Route path="demo-osce-case" element={<Navigate to="/" replace />} />
            <Route path="auth/callback" element={<AuthCallback />} />
            <Route path="app" element={<RequireApproved><CurriculumBrowser /></RequireApproved>} />
            <Route path="app/osce" element={<RequireApproved><OsceLibrary /></RequireApproved>} />
            <Route path="app/domain/:num" element={<RequireApproved><DomainDetail /></RequireApproved>} />
            <Route path="app/line/:code" element={<RequireApproved><LineView /></RequireApproved>} />
            <Route path="owner" element={<RequireAuth><AppHome /></RequireAuth>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
