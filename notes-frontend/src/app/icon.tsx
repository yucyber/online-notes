import { ImageResponse } from 'next/og'

export const size = {
  width: 64,
  height: 64,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
          color: '#fff',
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: '-0.05em',
        }}
      >
        N
      </div>
    ),
    size
  )
}

