// 問い合わせの入り口（本人の決め 2026-11-19：ジム・トレッドミルでの導入や共同開発の相談を受ける。連絡先は Google フォーム）。
// ホームのいちばん下と、フォームの見方のページの最後に、小さく1行だけ出す（走る画面・結果の画面には出さない）。
// CONTACT_URL が null の間は何も出さない（フォームができたら URL を入れる）
export const CONTACT_URL: string | null = null

export function ContactLink() {
  if (!CONTACT_URL) return null
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, textAlign: 'center' }} className="muted">
      ジム・トレッドミルでの導入や、共同開発のご相談は{' '}
      <a href={CONTACT_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>
        こちらのフォーム
      </a>
    </div>
  )
}
