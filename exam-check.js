// The exam server's connection check (EXAM_MODE /check): asks the exam server
// for an answer once a second for a minute, then says whether this computer's
// connection (LAN cable or Wi-Fi) is good enough for an exam. Each check also
// reports its speed, so the Trial Run page can list this computer.
const TOTAL = 60;
const $ = id => document.getElementById(id);
let run = 0;

function verdict(s) {
  if (!s.ok) return ['bad', '✕', 'Can\'t reach the exam server', 'Check the LAN cable or Wi-Fi, and that the address is right.'];
  if (s.drops > 0) return ['warn', '!', 'The connection dropped', `${s.drops} of ${s.done} checks got no answer. Check the cable is pushed in firmly, or try another port on the switch.`];
  if (s.avg > 300) return ['warn', '!', 'The connection is slow', 'It works, but answers may save slowly. Try a LAN cable instead of Wi-Fi.'];
  return ['good', '✓', 'Connected to the exam server', s.done < TOTAL ? 'Still checking… keep this page open.' : 'This computer is ready for the exam.'];
}

function paint(s) {
  const [cls, mark, headline, detail] = verdict(s);
  $('status').className = `status ${cls}`;
  $('dot').textContent = mark;
  $('headline').textContent = headline;
  $('detail').textContent = detail;
  $('via').textContent = s.via || '—';
  $('ip').textContent = s.ip || '—';
  $('avg').textContent = s.times.length ? `${s.avg} ms` : '—';
  $('drops').textContent = `${s.drops}`;
  $('bar').style.width = `${(s.done / TOTAL) * 100}%`;
  $('count').textContent = `${s.done} of ${TOTAL} checks${s.times.length ? ` · slowest ${Math.max(...s.times)} ms` : ''}`;
}

async function check() {
  const mine = ++run;
  $('again').disabled = true;
  const s = { done: 0, drops: 0, times: [], avg: 0, ok: true, via: '', ip: '' };
  let last = '';
  for (let i = 0; i < TOTAL && mine === run; i++) {
    const t0 = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    try {
      const res = await fetch(`/api/check/ping?rtt=${last}&t=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
      const data = await res.json();
      const ms = Math.round(performance.now() - t0);
      s.times.push(ms);
      last = ms;
      s.via = data.via;
      s.ip = data.ip;
    } catch {
      s.drops++;
      last = '';
    }
    clearTimeout(timer);
    s.done = i + 1;
    s.avg = s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0;
    s.ok = s.times.length > 0 || s.done < 3;
    if (mine === run) paint(s);
    const wait = 1000 - (performance.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  if (mine === run) $('again').disabled = false;
}

$('again').addEventListener('click', check);
check();
