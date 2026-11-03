// 샌드박스 진입점. 실행: npx vite --config src/features/trip/sandbox/vite.config.ts  (README.md 참고)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../index.css'
import { Sandbox } from './Sandbox'

createRoot(document.getElementById('root')!).render(<StrictMode><Sandbox /></StrictMode>)
