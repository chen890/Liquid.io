import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serverPort = env.EXTRACTION_SERVER_PORT ?? '3712'

  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
