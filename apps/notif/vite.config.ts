import { defineConfig } from 'vite'
import { createStandaloneViteConfig } from '../_shared/standalone-vite'
import notifServer from '../../vite-plugins/notif-server'

export default defineConfig({
  ...createStandaloneViteConfig(import.meta.url, 5179),
  plugins: [notifServer()],
})
