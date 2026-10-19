// Mac から iPhone に、同じ Wi-Fi で https でアプリを配る開発サーバー（npm run dev:https）。手順は docs/dev-https.md
// iPhone の Safari でカメラを使うには https が要る。ふだんの vite.config.ts と npm run build・公開（Vercel）には関係しない。
// - 証明書は自分で作った1枚（自己署名）。リポジトリの外（~/.config/run-form-coach/dev-cert/）に置き、
//   Mac の Wi-Fi のアドレスが変わったら作り直す
// - iPhone に証明書を入れるときは、https://<Mac のアドレス>:5173/rfc-dev-cert.cer を開く（このサーバーだけが出す）
// - 記録を送る /api/upload は Vite にはないので、公開先（Vercel）の関数に回す（送るときだけ1回読みに行く）
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

const PUBLIC_SITE = 'https://run-form-coach.vercel.app'
const dir = join(homedir(), '.config/run-form-coach/dev-cert')
const keyFile = join(dir, 'key.pem')
const certFile = join(dir, 'cert.pem')
const derFile = join(dir, 'cert.cer')
const metaFile = join(dir, 'names.json')

// この Mac の Wi-Fi などのアドレス（IPv4）と名前
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a.address)
const local = `${hostname().replace(/\.local$/, '')}.local`
const names = ['localhost', local, '127.0.0.1', ...ips]

function ensureCert() {
  const old = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : []
  if (existsSync(keyFile) && existsSync(certFile) && existsSync(derFile) && names.every((n) => old.includes(n))) return
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const san = names.map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',')
  // iPhone で「信頼」にできるよう、自分自身を発行元にした証明書（CA:true）にする。iOS は有効期限 825 日までしか受け付けない
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '397', '-sha256',
    '-keyout', keyFile, '-out', certFile, '-subj', '/CN=run-form-coach dev',
    '-addext', `subjectAltName=${san}`, '-addext', 'basicConstraints=critical,CA:true', '-addext', 'extendedKeyUsage=serverAuth',
  ], { stdio: 'ignore' })
  execFileSync('openssl', ['x509', '-in', certFile, '-outform', 'der', '-out', derFile])
  writeFileSync(metaFile, JSON.stringify(names))
  console.log(`\n証明書を作りました（${names.join(', ')}）。iPhone に入れ直してください（docs/dev-https.md）\n`)
}
ensureCert()

export default mergeConfig(
  base,
  defineConfig({
    server: {
      host: true,
      https: { key: readFileSync(keyFile), cert: readFileSync(certFile) },
      proxy: { '/api': { target: PUBLIC_SITE, changeOrigin: true, secure: true } },
    },
    plugins: [
      {
        name: 'rfc-dev-cert',
        configureServer(server) {
          server.middlewares.use('/rfc-dev-cert.cer', (_req, res) => {
            res.setHeader('content-type', 'application/x-x509-ca-cert')
            res.setHeader('content-disposition', 'attachment; filename="rfc-dev-cert.cer"')
            res.end(readFileSync(derFile))
          })
          server.httpServer?.once('listening', () => {
            const addr = server.httpServer?.address()
            const port = addr && typeof addr === 'object' ? addr.port : 5173
            const ip = ips[0] ?? local
            console.log(`\niPhone の Safari で開く: https://${ip}:${port}/   （証明書を入れる: https://${ip}:${port}/rfc-dev-cert.cer）\n`)
          })
        },
      },
    ],
  }),
)
