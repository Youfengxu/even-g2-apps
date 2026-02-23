import { defineConfig } from 'vite'
import { createStandaloneViteConfig } from '../_shared/standalone-vite'

export default defineConfig(createStandaloneViteConfig(import.meta.url, 5174))
