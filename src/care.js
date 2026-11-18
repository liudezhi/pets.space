import { request } from './gardens.js';
import { preparePhoto, readOriginal } from './photos.js';
import './care.css';

function node(tag, content = '') {
  const item = document.createElement(tag);
  item.textContent = content;
  return item;
}
function labelled(title, input) {
  const label = node('label', title);
  label.append(input);
  return label;
}
function button(label, run, notice) {
  const item = node('button', label);
  item.type = 'button';
  item.className = 'garden-btn';
  item.onclick = async () => {
    item.disabled = true;
    if (notice) notice.textContent = '';
    try {
      await run();
    } catch (error) {
      if (notice) notice.textContent = error.message;
    } finally {
      item.disabled = false;
    }
  };
  return item;
}
const statusLine = () => {
  const line = node('p');
  line.className = 'garden-status';
  line.setAttribute('role', 'status');
  return line;
};
function field(value = '', long = false) {
  const item = node(long ? 'textarea' : 'input');
  item.value = value;
  return item;
}
function section(parent, title) {
  const area = node('details');
  area.append(node('summary', title));
  parent.append(area);
  return area;
}
function post(path, body, method = 'POST') {
  return request(path, { method, body });
}
function downloadLink(url, label) {
  const a = node('a', label);
  a.className = 'garden-btn';
  a.href = url;
  a.download = '';
  return a;
}
export function addCare(body, garden, { refresh, removed }) {
  const base = '/api/gardens/' + encodeURIComponent(garden.id);
  const area = node('div');
  area.className = 'archive-care';
  body.append(area);
  if (garden.isOwner || garden.id === 'demo-riverbend')
    area.append(downloadLink(base + '/archive', garden.isOwner ? '导出离线纪念册' : '下载麦子的示例纪念册'));
  const album = section(area, '家庭相册');
  const images = node('div');
  images.className = 'care-images';
  const notice = statusLine();
  async function loadPhotos() {
    const { photos } = await request(base + '/album');
    images.replaceChildren();
    if (!photos.length)
      images.append(node('p', garden.isOwner ? '可以把珍藏的原图保存在这里。' : '主人暂未公开其他照片。'));
    for (const photo of photos) {
      const fig = node('figure'),
        image = new Image();
      image.alt = garden.name + '的相册照片';
      image.src = photo.previewUrl;
      fig.append(image);
      if (garden.isOwner) {
        const label = photo.isPublic ? '设为私密' : '允许访客查看';
        fig.append(
          button(
            label,
            async () => {
              await post(base + '/album/' + photo.id, { isPublic: !photo.isPublic }, 'PATCH');
              await loadPhotos();
            },
            notice,
          ),
        );
        fig.append(
          button(
            '移除照片',
            async () => {
              if (!window.confirm('从档案中移除这张原图及展示图？')) return;
              await post(base + '/album/' + photo.id, { remove: true });
              await loadPhotos();
            },
            notice,
          ),
        );
      }
      images.append(fig);
    }
  }
  album.append(images);
  if (garden.isOwner) {
    const file = field();
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp';
    album.append(
      labelled('保存原始照片（最多 6 张，每张 8 MiB）', file),
      button(
        '加入私密相册',
        async () => {
          const f = file.files[0];
          if (!f || f.size > 8 * 1024 * 1024) throw Error('请选择 8 MiB 以内的照片。');
          const { preview, mime } = await preparePhoto(f);
          await post(base + '/album', { ...(await readOriginal(f, mime)), preview });
          file.value = '';
          await loadPhotos();
          notice.textContent = '原件已私密保存。访客仅能看到你允许公开的展示图。';
        },
        notice,
      ),
    );
  }
  album.append(notice);
  album.addEventListener('toggle', () => {
    if (album.open) loadPhotos().catch((err) => (notice.textContent = err.message));
  });
  if (!garden.isOwner) return;
  const edit = section(area, '档案管理');
  const name = field(garden.name),
    story = field(garden.story, true),
    msg = statusLine();
  name.maxLength = 40;
  story.maxLength = 2000;
  edit.append(
    labelled('纪念名字', name),
    labelled('回忆', story),
    button(
      '保存修改',
      async () => {
        await post(base + '/record', { name: name.value, story: story.value }, 'PATCH');
        await refresh();
      },
      msg,
    ),
  );
  edit.append(node('p', '离线纪念册包含私人寄语和已存原件，请妥善保管。'), msg);
  const transfer = section(area, '交给家人维护');
  const recipient = field(),
    offerStatus = statusLine();
  transfer.append(
    node('p', '填入家人在「家庭交接」中取得的接收编号。接收完成后，相册和私人寄语随档案移交，花园转为私密。'),
    labelled('家人接收编号', recipient),
    button(
      '生成交接码',
      async () => {
        const { code } = await post(base + '/handover', { recipient: recipient.value.trim() });
        offerStatus.textContent = '七天内有效，仅指定家人可领取：' + code;
      },
      offerStatus,
    ),
    button(
      '撤回交接码',
      async () => {
        await post(base + '/handover', { cancel: true });
        offerStatus.textContent = '已撤回。';
      },
      offerStatus,
    ),
    offerStatus,
  );
  const danger = section(area, '删除这座花园');
  const confirm = field(),
    deletion = statusLine();
  danger.append(
    node('p', '删除将移除当前服务中的档案、原图、寄语与收到的花。建议先导出离线纪念册。'),
    labelled('输入完整宠物名字确认删除', confirm),
    button(
      '永久删除这座花园',
      async () => {
        if (confirm.value !== garden.name) throw Error('名字不符，请重新核对。');
        if (!window.confirm('确认删除这座花园及其个人资料？')) return;
        await post(base + '/record', { confirmName: confirm.value });
        removed();
      },
      deletion,
    ),
    deletion,
  );
}

export async function showHandover(body, openGarden, isCurrent) {
  const { recipient } = await request('/api/care/identity');
  if (!isCurrent()) return;
  const id = field(recipient);
  id.readOnly = true;
  const claim = field(),
    status = statusLine();
  body.classList.add('care-form');
  body.replaceChildren(
    labelled('我的接收编号', id),
    node('p', '将接收编号交给原园主；收到七天有效的交接码后，在这里接收。'),
    labelled('交接码', claim),
    button(
      '接收家庭档案',
      async () => {
        const { id } = await post('/api/care/accept', { code: claim.value.trim() });
        openGarden(id);
      },
      status,
    ),
    status,
  );
  const exit = button(
    '退出这台设备',
    async () => {
      if (!window.confirm('已保存园主恢复码？退出后需要使用它重新登录。')) return;
      await post('/api/sign-out', {});
      location.replace(location.pathname);
    },
    status,
  );
  body.append(exit);
}

export async function showWishes(body, isCurrent) {
  body.classList.add('care-form');
  const [wall, session] = await Promise.all([request('/api/wishes'), request('/api/session')]);
  if (!isCurrent()) return;
  const intro = node('p', '风吹过布带时，愿意公开的寄语也留在这棵树下。');
  const publicList = node('ul');
  publicList.className = 'wish-list';
  for (const wish of wall.wishes) publicList.append(node('li', wish.name + ' · ' + wish.message));
  body.replaceChildren(intro, publicList);
  if (!session.owner) {
    body.append(node('p', '园主可为自己的宠物系一条心愿。'));
    return;
  }
  const { gardens } = await request('/api/mine');
  if (!isCurrent()) return;
  if (!gardens.length) {
    body.append(node('p', '先在「我的花园」建立一座纪念花园，再来写下寄语。'));
    return;
  }
  const choose = node('select'),
    message = field('', true),
    share = field(),
    status = statusLine(),
    mine = node('ul');
  mine.className = 'wish-list';
  message.maxLength = 180;
  share.type = 'checkbox';
  for (const g of gardens) choose.append(new Option(g.name, g.id));
  const render = async () => {
    const selected = choose.value;
    const { wishes } = await request('/api/gardens/' + selected + '/wishes');
    if (!isCurrent() || choose.value !== selected) return;
    mine.replaceChildren();
    for (const w of wishes) {
      const li = node('li', (w.isPublic ? '可随花园公开' : '私密') + ' · ' + w.message);
      li.append(
        button(
          '移除',
          async () => {
            await post('/api/gardens/' + selected + '/wishes/' + w.id, { remove: true });
            await showWishes(body, isCurrent);
          },
          status,
        ),
      );
      mine.append(li);
    }
  };
  choose.onchange = () => render().catch((e) => (status.textContent = e.message));
  let draftKey = null,
    signature = '';
  body.append(
    node('h3', '我的寄语'),
    labelled('选择花园', choose),
    labelled('给它的心愿（180 字以内）', message),
    labelled('当花园公开时展示这条寄语', share),
    button(
      '系上心愿',
      async () => {
        if (!message.value.trim()) throw Error('请写下一句话。');
        const draft = JSON.stringify([choose.value, message.value, share.checked]);
        if (draft !== signature) {
          signature = draft;
          draftKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
            v.toString(16).padStart(2, '0'),
          ).join('');
        }
        await post('/api/gardens/' + choose.value + '/wishes', {
          message: message.value,
          isPublic: share.checked,
          requestId: draftKey,
        });
        await showWishes(body, isCurrent);
      },
      status,
    ),
    status,
    mine,
  );
  await render();
}
