import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';
export const alt = 'Гуулингийнхан — Монгол Ургийн Бичиг & Удмын Мод';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'linear-gradient(135deg, #102a20 0%, #17372b 58%, #0f241c 100%)',
          color: '#f7f1e5',
          border: '12px solid #c89b3c',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: 22,
            letterSpacing: '0.18em',
            color: '#e6c67c',
            fontWeight: 700,
          }}
        >
          <span>МОНГОЛ УРГИЙН БИЧИГ · ДИЖИТАЛ ӨВ СОЁЛ</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05, color: '#ffffff' }}>
            ГУУЛИНГИЙНХАН
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.35, color: '#e5dcc8', maxWidth: '880px' }}>
            Үе үеийн ургийн мод, намтар түүх, гэрэл зургийн цомог болон удмын сангийн нэгдсэн өргөө.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(200, 155, 60, 0.4)',
            paddingTop: '24px',
            fontSize: 22,
            color: '#d9c496',
          }}
        >
          <span>Ургийн Мод · Хамаарал Тооцоолуур · Архив</span>
          <span>guulingiinhan</span>
        </div>
      </div>
    ),
    size,
  );
}
