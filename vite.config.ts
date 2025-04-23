import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import fs from 'fs';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: fs.readFileSync('certificates/key.pem'),
      cert: fs.readFileSync('certificates/cert.pem'),
    },
    host: '0.0.0.0',
    port: 5173,
  },
});
