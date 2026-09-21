import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// StudyEFRM web — Vite + React
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
