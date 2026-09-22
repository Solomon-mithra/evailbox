import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

async function main() {
  const regular = await readFile('scripts/assets/Inter-Regular.ttf');
  const semibold = await readFile('scripts/assets/Inter-SemiBold.ttf');
  const mark = `data:image/svg+xml;base64,${(await readFile('public/icon.svg')).toString('base64')}`;
  const fonts = [
    { name: 'Inter', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: semibold, weight: 600 as const, style: 'normal' as const },
  ];

  const preview = new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        fontFamily: 'Inter',
        background: '#f8fafc',
        color: '#044b39',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 370,
          height: '100%',
          backgroundImage: 'linear-gradient(155deg, #cbf39d 0%, #c8efc1 52%, #bdf0ec 100%)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '55px 60px', width: 845 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 15,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: '-1.5px',
          }}
        >
          {/* Static artwork: intrinsic dimensions are supplied for the PNG renderer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" width={56} height={56} />
          evailbox
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 64,
            fontSize: 66,
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: '-3px',
          }}
        >
          <span>Important emails.</span>
          <span style={{ color: '#5a733d', marginTop: 6 }}>Out of the noise.</span>
        </div>
        <div
          style={{
            display: 'flex',
            maxWidth: 560,
            marginTop: 30,
            fontSize: 26,
            lineHeight: 1.45,
            color: '#536a64',
          }}
        >
          AI email organization for your work and life.
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 'auto',
            fontSize: 20,
            color: '#536a64',
          }}
        >
          <span>Made for Gmail & Outlook</span>
          <span style={{ width: 5, height: 5, borderRadius: 50, background: '#7b9185' }} />
          <span>Your priorities first</span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          right: 47,
          top: 167,
          width: 296,
          padding: 25,
          background: '#fff',
          borderRadius: 24,
          border: '1px solid #d8e4dc',
          boxShadow: '0 18px 45px rgba(4, 75, 57, 0.12)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 15,
            color: '#536a64',
          }}
        >
          <span>YOUR PRIORITIES</span>
          <span style={{ width: 9, height: 9, borderRadius: 50, background: '#72c613' }} />
        </div>
        <div
          style={{
            display: 'flex',
            padding: '14px 16px',
            marginTop: 22,
            background: '#cbf39d',
            borderRadius: 12,
            fontSize: 23,
            fontWeight: 600,
          }}
        >
          Needs a reply
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 25 }}>
          {[
            ['Work', '#c8efc1', 172],
            ['Personal', '#bdf0ec', 144],
          ].map(([label, color, width]) => (
            <div
              key={label}
              style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 18 }}>
                <span
                  style={{
                    display: 'flex',
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: color as string,
                  }}
                />
                {label}
              </div>
              <div
                style={{
                  width: width as number,
                  height: 7,
                  background: '#e6eeea',
                  borderRadius: 5,
                  marginLeft: 39,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );
  await mkdir('public/og', { recursive: true });
  await writeFile('public/og/evailbox.png', Buffer.from(await preview.arrayBuffer()));

  for (const [size, filename] of [
    [180, 'apple-touch-icon.png'],
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [32, 'favicon.ico'],
  ] as const) {
    const icon = new ImageResponse(
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: '#044b39',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} alt="" width={size} height={size} />
      </div>,
      { width: size, height: size },
    );
    const png = Buffer.from(await icon.arrayBuffer());
    if (filename === 'favicon.ico') {
      // ICO directory with one PNG-compressed 32px image.
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2);
      header.writeUInt16LE(1, 4);
      header[6] = size;
      header[7] = size;
      header.writeUInt16LE(1, 10);
      header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14);
      header.writeUInt32LE(22, 18);
      await writeFile(`public/${filename}`, Buffer.concat([header, png]));
    } else {
      await writeFile(`public/${filename}`, png);
    }
  }
  console.log('Generated social preview, favicon, Apple touch icon and application icons.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
