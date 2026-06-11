import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Replace 'wedding-planner' with your actual GitHub repo name
  base: '/wedding-planner/',
})
