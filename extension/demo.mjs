export async function matchScheduleImage(context) {
  const canvas = document.createElement('canvas'); canvas.width = 760; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101011'; ctx.fillRect(0, 0, 760, 720);
  ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText('Champions · Playoffs', 32, 50);
  ctx.font = '16px sans-serif'; ctx.fillStyle = '#b6b6bb'; ctx.fillText('SIMULATED SCHEDULE · DEVELOPMENT PREVIEW', 32, 80);
  const next = new Date(Date.parse(context.anchorDate + 'T12:00:00Z') + 2 * 86_400_000);
  const heading = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(next);
  ['Tomorrow', heading].forEach((label, group) => {
    const top = 130 + group * 280;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(label, 32, top);
    ['PRX vs T1', 'NS vs 100T', 'LOUD vs NRG', 'VIT vs G2'].slice(group * 2, group * 2 + 2).forEach((title, row) => {
      const y = top + 24 + row * 110; ctx.fillStyle = '#232326'; ctx.fillRect(32, y, 696, 94);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText(row ? '7:00 AM' : '4:00 AM', 54, y + 38); ctx.fillText(title, 265, y + 38);
      ctx.fillStyle = '#a1a1aa'; ctx.font = '16px sans-serif'; ctx.fillText('Champions · Playoffs', 265, y + 70); ctx.fillText('Bo3', 658, y + 70);
    });
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create the example schedule.');
  return new File([blob], 'Simulated match schedule.png', { type: 'image/png' });
}
