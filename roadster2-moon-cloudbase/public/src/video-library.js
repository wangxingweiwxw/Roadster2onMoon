const chapters = [
  { id: 'xray', title: '结构透视', tag: 'X-RAY / 01', duration: '0:30', summary: '透过车身，看驱动、储罐与推进系统的布局。', action: '进入游戏后，用 C 切换视角观察车辆。' },
  { id: 'ceiling', title: '倒挂吸附', tag: 'CEILING / 02', duration: '2:00', summary: '理解有大气环境下，气压差如何提供贴附力。月面真空中的吸附采用游戏设定。', action: '游戏操作：E 切换吸附；基地墙面停稳后自动补气。' },
  { id: 'launch', title: '喷气加速', tag: 'LAUNCH / 03', duration: '2:00', summary: '从速度与推力出发，理解压缩空气辅助加速。', action: '游戏操作：按住 Shift 加速，注意右下角气罐余量。' },
  { id: 'hover', title: '悬停腾空', tag: 'HOVER / 04', duration: '2:00', summary: '理解向下喷气产生的升力，以及悬停时的受力平衡。', action: '游戏操作：空格腾空与喷气上升；W/S 俯仰，A/D 横滚。' },
];

export function initVideoLibrary({ onOpen, onClose }) {
  const dialog = document.querySelector('#videoDialog');
  const player = dialog.querySelector('video');
  const status = dialog.querySelector('#videoStatus');
  const playlist = dialog.querySelector('#videoPlaylist');
  const cards = document.querySelector('#principleCards');
  let selected = 0;
  let open = false;
  const asset = (chapter, extension) => `./assets/videos/${chapter.id}.${extension}`;
  const renderCard = (chapter, index, compact = false) => `<button type="button" class="principle-card${compact ? ' compact' : ''}" data-chapter="${index}" aria-label="播放${chapter.title}，${chapter.duration}"><span class="principle-thumb"><img src="${asset(chapter, 'jpg')}" alt="" width="640" height="360" decoding="async"><span class="principle-play" aria-hidden="true">▶</span><span class="principle-duration">${chapter.duration}</span></span><span class="principle-caption"><small>${chapter.tag}</small><strong>${chapter.title}</strong></span></button>`;
  cards.innerHTML = chapters.map((c, i) => renderCard(c, i)).join('');
  playlist.innerHTML = chapters.map((c, i) => renderCard(c, i, true)).join('');
  function select(index) {
    selected = index;
    const chapter = chapters[index];
    player.pause();
    player.poster = asset(chapter, 'jpg');
    player.src = asset(chapter, 'mp4');
    dialog.querySelector('#videoTitle').textContent = chapter.title;
    dialog.querySelector('#videoSummary').textContent = chapter.summary;
    dialog.querySelector('#videoAction').textContent = chapter.action;
    playlist.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    status.textContent = '正在加载…';
    player.load();
    player.play().catch(() => { if (open && selected === index && !player.error) status.textContent = '点击播放器中的播放按钮开始。'; });
  }
  function show(index = selected) {
    if (!open) { open = true; onOpen(); dialog.showModal(); }
    select(index);
  }
  dialog.addEventListener('close', () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    if (open) { open = false; onClose(); }
  });
  dialog.querySelector('#videoClose').addEventListener('click', () => dialog.close());
  dialog.querySelector('#videoNext').addEventListener('click', () => select((selected + 1) % chapters.length));
  player.addEventListener('playing', () => { status.textContent = '正在播放 · 可全屏观看'; });
  player.addEventListener('waiting', () => { if (open) status.textContent = '正在缓冲…'; });
  player.addEventListener('ended', () => { status.textContent = '本章播放完毕，可选择下一章。'; });
  player.addEventListener('error', () => { if (open) status.textContent = '视频加载失败，请重新选择本章重试。'; });
  for (const container of [cards, playlist]) container.addEventListener('click', event => {
    const button = event.target.closest('[data-chapter]');
    if (button) show(Number(button.dataset.chapter));
  });
  document.querySelectorAll('[data-open-videos]').forEach(button => button.addEventListener('click', () => show()));
  return { show, get isOpen() { return open; } };
}
