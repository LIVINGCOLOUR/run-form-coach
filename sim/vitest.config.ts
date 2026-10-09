import { defineConfig } from 'vitest/config'

// 仮想実験は通常のテストとは別に動かす： npx vitest run --config sim/vitest.config.ts
// 研究データの置き場所は環境変数 RBDS_DIR で渡す
export default defineConfig({
  test: { include: ['sim/**/*.sim.ts'], testTimeout: 600000 },
})
