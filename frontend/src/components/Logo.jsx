// Kinoticket im LiLief-Stil: Verlauf aus den Theme-Tokens, kleines Herz als
// Familien-Signatur (bei LiLief-Workout sitzt es auf der Hantel).
export default function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lilief-kino-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--grad-from)" />
          <stop offset="1" stopColor="var(--grad-to)" />
        </linearGradient>
      </defs>
      <path d="M70 150h372a0 0 0 0 1 0 0v62a44 44 0 0 0 0 88v62H70v-62a44 44 0 0 0 0-88z" fill="url(#lilief-kino-g)" />
      <path d="M200 215h112M200 297h112" stroke="var(--bg)" strokeWidth="26" strokeLinecap="round" />
      <path
        d="M388 56a34 34 0 0 0-30 18 34 34 0 0 0-30-18 34 34 0 0 0-34 34c0 36 40 58 64 78 24-20 64-42 64-78a34 34 0 0 0-34-34z"
        fill="var(--accent)"
        transform="translate(-6 24)"
      />
    </svg>
  )
}
