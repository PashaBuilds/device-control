/// <reference types="vite/client" />

declare module '*.css'

/** Derleme anında package.json sürümünden doldurulur (electron.vite.config.ts define). */
declare const __APP_VERSION__: string
